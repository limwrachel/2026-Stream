/**
 * FHIR Parser Test Screen (DEV ONLY)
 *
 * Loads local FHIR fixture bundles, runs the deterministic
 * lib/services/fhir parser, and renders the 7-section
 * MedicalHistoryPrefill output for inspection.
 *
 * Guard: returns null in production (__DEV__ === false).
 * Reachable via Profile → Developer → Parser Test.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Alert,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAppTheme } from '@/lib/theme/ThemeContext';
import { buildMedicalHistoryPrefill } from '@/lib/services/fhir';
import type {
  MedicalHistoryPrefill,
  PrefillEntry,
  ClinicalRecordsInput,
  HealthKitDemographics,
} from '@/lib/services/fhir';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures — statically required so Metro bundles them (no filesystem APIs).
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-require-imports
const FIXTURE_MAP = {
  'Patient A – Eli Rowan': require('@/assets/fhir-fixtures/patient_A.bundle.json'),
  'Patient B – Maya Navarro': require('@/assets/fhir-fixtures/patient_B.bundle.json'),
  'Patient C – Noah Kim': require('@/assets/fhir-fixtures/patient_C.bundle.json'),
} as const;

type FixtureKey = keyof typeof FIXTURE_MAP;
const FIXTURE_KEYS = Object.keys(FIXTURE_MAP) as FixtureKey[];

// ─────────────────────────────────────────────────────────────────────────────
// Bundle adapter — normalise to a flat resource array
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeToResources(raw: any): any[] {
  // FHIR Bundle: { resourceType: "Bundle", entry: [{resource: ...}, ...] }
  if (raw?.resourceType === 'Bundle' && Array.isArray(raw.entry)) {
    return (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      raw.entry.map((e: any) => e?.resource).filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (r: any): r is Record<string, unknown> =>
          r != null && typeof r.resourceType === 'string',
      )
    );
  }
  // Alternate: { resources: [...] }
  if (Array.isArray(raw?.resources)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (raw.resources as any[]).filter(Boolean);
  }
  // Single resource
  if (raw?.resourceType) return [raw];
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers: extract display name from a raw FHIR resource
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rawDisplayName(resource: any): string {
  const rt: string = resource.resourceType ?? '';
  if (
    rt === 'MedicationRequest' ||
    rt === 'MedicationOrder' ||
    rt === 'MedicationStatement'
  ) {
    const cc = resource.medicationCodeableConcept ?? resource.medication;
    if (cc?.text) return cc.text as string;
    if (Array.isArray(cc?.coding) && cc.coding[0]?.display)
      return cc.coding[0].display as string;
    if (resource.medicationReference?.display)
      return resource.medicationReference.display as string;
    return rt;
  }
  const cc = resource.code;
  if (cc?.text) return cc.text as string;
  if (Array.isArray(cc?.coding) && cc.coding[0]?.display)
    return cc.coding[0].display as string;
  return rt;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build ClinicalRecordsInput from raw bundle resources
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildClinicalInput(resources: any[]): ClinicalRecordsInput {
  const medications: ClinicalRecordsInput['medications'] = [];
  const labResults: ClinicalRecordsInput['labResults'] = [];
  const conditions: ClinicalRecordsInput['conditions'] = [];
  const procedures: ClinicalRecordsInput['procedures'] = [];

  for (const r of resources) {
    const displayName = rawDisplayName(r);
    const fhirResource = r as Record<string, unknown>;
    switch (r.resourceType as string) {
      case 'MedicationRequest':
      case 'MedicationOrder':
      case 'MedicationStatement':
        medications.push({ displayName, fhirResource });
        break;
      case 'Observation':
      case 'DiagnosticReport':
        labResults.push({ displayName, fhirResource });
        break;
      case 'Condition':
        conditions.push({ displayName, fhirResource });
        break;
      case 'Procedure':
        procedures.push({ displayName, fhirResource });
        break;
    }
  }

  return { medications, labResults, conditions, procedures };
}

// ─────────────────────────────────────────────────────────────────────────────
// Extract HealthKitDemographics from the Patient resource
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractDemographics(resources: any[]): HealthKitDemographics | null {
  const patient = resources.find((r) => r.resourceType === 'Patient');
  if (!patient) return null;

  let age: number | null = null;
  const birthDate: string | null =
    typeof patient.birthDate === 'string' ? patient.birthDate : null;

  if (birthDate) {
    const born = new Date(birthDate);
    const now = new Date();
    age = now.getFullYear() - born.getFullYear();
    const m = now.getMonth() - born.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < born.getDate())) age -= 1;
  }

  const biologicalSex: string | null =
    typeof patient.gender === 'string' ? patient.gender : null;

  return { age, dateOfBirth: birthDate, biologicalSex };
}

// ─────────────────────────────────────────────────────────────────────────────
// Run the parser against a fixture
// ─────────────────────────────────────────────────────────────────────────────

interface ParseResult {
  prefill: MedicalHistoryPrefill;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawResources: any[];
  resourceCount: number;
  durationMs: number;
}

function runParser(key: FixtureKey): ParseResult {
  const raw = FIXTURE_MAP[key];
  const resources = normalizeToResources(raw);
  const clinicalInput = buildClinicalInput(resources);
  const demographics = extractDemographics(resources);
  const t0 = Date.now();
  const prefill = buildMedicalHistoryPrefill(clinicalInput, demographics);
  return {
    prefill,
    rawResources: resources,
    resourceCount: resources.length,
    durationMs: Date.now() - t0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared sub-components
// ─────────────────────────────────────────────────────────────────────────────

// ── Confidence badge ──────────────────────────────────────────────────────────

const CONF_COLOR: Record<string, string> = {
  high: '#30D158',
  medium: '#FF9F0A',
  low: '#FF453A',
  none: '#636366',
};

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const color = CONF_COLOR[confidence] ?? '#636366';
  return (
    <View style={[badgeS.pill, { backgroundColor: color + '33' }]}>
      <Text style={[badgeS.text, { color }]}>{confidence}</Text>
    </View>
  );
}

const badgeS = StyleSheet.create({
  pill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  text: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
});

// ── Prefill row ───────────────────────────────────────────────────────────────

function PrefillRow({
  label,
  entry,
  renderValue,
}: {
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entry: PrefillEntry<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renderValue?: (v: any) => string;
}) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const hasValue = entry.value != null;
  const displayValue = hasValue
    ? renderValue
      ? renderValue(entry.value)
      : String(entry.value)
    : '—';

  return (
    <View style={rowS.row}>
      <Text style={[rowS.label, { color: c.textSecondary }]}>{label}</Text>
      <View style={rowS.right}>
        <Text
          style={[
            rowS.value,
            { color: hasValue ? c.textPrimary : c.textTertiary },
            !hasValue && rowS.empty,
          ]}
          numberOfLines={3}
        >
          {displayValue}
        </Text>
        <ConfidenceBadge confidence={entry.confidence} />
      </View>
    </View>
  );
}

const rowS = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 7,
    gap: 8,
  },
  label: { fontSize: 14, flex: 1, paddingTop: 1 },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    maxWidth: '65%',
  },
  value: { fontSize: 14, fontWeight: '500', textAlign: 'right', flexShrink: 1 },
  empty: { fontStyle: 'italic' },
});

// ── Section card ──────────────────────────────────────────────────────────────

function SectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
}) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  return (
    <View style={[sCardS.card, { backgroundColor: c.card }]}>
      <View style={sCardS.header}>
        <IconSymbol name={icon as any} size={14} color={c.textTertiary} />
        <Text style={[sCardS.title, { color: c.textTertiary }]}>{title}</Text>
      </View>
      <View style={[sCardS.divider, { backgroundColor: c.separator }]} />
      {children}
    </View>
  );
}

const sCardS = StyleSheet.create({
  card: { borderRadius: 14, padding: 16, marginBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 },
  title: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  divider: { height: StyleSheet.hairlineWidth, marginBottom: 6 },
});

// ── Collapsible JSON viewer ───────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function JsonViewer({ data }: { data: any }) {
  const [expanded, setExpanded] = useState(false);
  const { theme } = useAppTheme();
  const c = theme.colors;
  const json = JSON.stringify(data, null, 2);
  const count = Array.isArray(data) ? (data as unknown[]).length : null;

  return (
    <View style={[jsonS.card, { backgroundColor: c.card }]}>
      <TouchableOpacity
        style={jsonS.toggleRow}
        onPress={() => setExpanded((v) => !v)}
        activeOpacity={0.7}
      >
        <IconSymbol
          name={(expanded ? 'chevron.up' : 'chevron.down') as any}
          size={14}
          color={c.textTertiary}
        />
        <Text style={[jsonS.toggleText, { color: c.accent }]}>
          {expanded ? 'Hide Raw FHIR Resources' : 'Show Raw FHIR Resources'}
        </Text>
        {count != null && (
          <Text style={[jsonS.count, { color: c.textTertiary }]}>
            {count} resource{count !== 1 ? 's' : ''}
          </Text>
        )}
      </TouchableOpacity>

      {expanded && (
        <ScrollView
          style={jsonS.scrollBox}
          nestedScrollEnabled
          showsVerticalScrollIndicator
        >
          <Text style={jsonS.jsonText}>{json}</Text>
        </ScrollView>
      )}
    </View>
  );
}

const jsonS = StyleSheet.create({
  card: { borderRadius: 14, padding: 16, marginBottom: 12 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toggleText: { fontSize: 15, fontWeight: '500', flex: 1 },
  count: { fontSize: 12 },
  scrollBox: {
    maxHeight: 380,
    marginTop: 12,
    backgroundColor: '#1A1A2E',
    borderRadius: 10,
    padding: 12,
  },
  jsonText: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: '#A5D6A7',
    lineHeight: 16,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// State type
// ─────────────────────────────────────────────────────────────────────────────

type RunState =
  | { status: 'idle' }
  | { status: 'success'; result: ParseResult }
  | { status: 'error'; message: string };

// ─────────────────────────────────────────────────────────────────────────────
// Main screen
// ─────────────────────────────────────────────────────────────────────────────

export default function FhirParserTestScreen() {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const router = useRouter();

  const [selectedFixture, setSelectedFixture] = useState<FixtureKey>(FIXTURE_KEYS[0]);
  const [runState, setRunState] = useState<RunState>({ status: 'idle' });

  // ── Run parser ──────────────────────────────────────────────────────
  const handleRun = useCallback(() => {
    try {
      const result = runParser(selectedFixture);
      setRunState({ status: 'success', result });
    } catch (err) {
      setRunState({
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [selectedFixture]);

  // ── Copy output JSON ────────────────────────────────────────────────
  const handleCopy = useCallback(async () => {
    if (runState.status !== 'success') return;
    const json = JSON.stringify(runState.result.prefill, null, 2);
    try {
      // Use expo-clipboard when available (npx expo install expo-clipboard).
      // require() avoids TS module-resolution errors for optional packages.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Clipboard = require('expo-clipboard');
      await (Clipboard.setStringAsync as (s: string) => Promise<void>)(json);
      Alert.alert('Copied', 'Prefill output JSON copied to clipboard.');
    } catch {
      // Fallback: native Share sheet (always available)
      try {
        await Share.share({ message: json });
      } catch {
        Alert.alert('Error', 'Could not copy or share output JSON.');
      }
    }
  }, [runState]);

  // Production guard — after all hooks to satisfy Rules of Hooks
  if (!__DEV__) return null;

  const prefill = runState.status === 'success' ? runState.result.prefill : null;
  const rawResources = runState.status === 'success' ? runState.result.rawResources : [];

  return (
    <SafeAreaView
      style={[mainS.container, { backgroundColor: c.background }]}
      edges={['top', 'bottom']}
    >
      {/* ── Navigation bar ── */}
      <View style={[mainS.navBar, { borderBottomColor: c.separator }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={mainS.backBtn}
          activeOpacity={0.7}
        >
          <IconSymbol name={'chevron.left' as any} size={18} color={c.accent} />
          <Text style={[mainS.backText, { color: c.accent }]}>Back</Text>
        </TouchableOpacity>
        <Text style={[mainS.navTitle, { color: c.textPrimary }]}>FHIR Parser Test</Text>
        {/* Balance spacer */}
        <View style={mainS.backBtn} />
      </View>

      <ScrollView
        style={mainS.scroll}
        contentContainerStyle={mainS.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Dev banner ── */}
        <View style={mainS.devBanner}>
          <IconSymbol name={'hammer.fill' as any} size={13} color="#FF9F0A" />
          <Text style={mainS.devBannerText}>
            DEV ONLY — not visible in production builds
          </Text>
        </View>

        {/* ── Fixture selector ── */}
        <View style={[mainS.card, { backgroundColor: c.card }]}>
          <View style={mainS.cardHeader}>
            <IconSymbol name={'doc.text' as any} size={14} color={c.textTertiary} />
            <Text style={[mainS.cardLabel, { color: c.textTertiary }]}>
              Select Fixture
            </Text>
          </View>

          {FIXTURE_KEYS.map((key) => {
            const active = selectedFixture === key;
            return (
              <TouchableOpacity
                key={key}
                style={[
                  mainS.fixtureRow,
                  {
                    borderColor: active ? c.accent : 'transparent',
                    backgroundColor: active ? c.accent + '18' : c.secondaryFill,
                  },
                ]}
                onPress={() => setSelectedFixture(key)}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    mainS.radio,
                    { borderColor: active ? c.accent : c.textTertiary },
                  ]}
                >
                  {active && (
                    <View style={[mainS.radioDot, { backgroundColor: c.accent }]} />
                  )}
                </View>
                <Text style={[mainS.fixtureLabel, { color: c.textPrimary }]}>
                  {key}
                </Text>
              </TouchableOpacity>
            );
          })}

          {/* Run button */}
          <TouchableOpacity
            style={[mainS.runBtn, { backgroundColor: c.accent }]}
            onPress={handleRun}
            activeOpacity={0.8}
          >
            <IconSymbol name={'play.fill' as any} size={14} color="#FFF" />
            <Text style={mainS.runBtnText}>Run Parser</Text>
          </TouchableOpacity>

          {/* Status */}
          {runState.status === 'success' && (
            <View style={mainS.statusRow}>
              <IconSymbol
                name={'checkmark.circle.fill' as any}
                size={15}
                color="#30D158"
              />
              <Text style={[mainS.statusText, { color: '#30D158' }]}>
                Parsed in {runState.result.durationMs} ms ·{' '}
                {runState.result.resourceCount} resources
              </Text>
            </View>
          )}
          {runState.status === 'error' && (
            <>
              <View style={mainS.statusRow}>
                <IconSymbol
                  name={'xmark.circle.fill' as any}
                  size={15}
                  color="#FF453A"
                />
                <Text style={[mainS.statusText, { color: '#FF453A' }]}>
                  Parse error
                </Text>
              </View>
              <Text style={mainS.errorDetail}>{runState.message}</Text>
            </>
          )}
        </View>

        {/* ── Prefill output sections ── */}
        {prefill && (
          <>
            {/* 1. Demographics */}
            <SectionCard title="Demographics" icon="person.fill">
              <PrefillRow label="Full Name" entry={prefill.demographics.fullName} />
              <PrefillRow
                label="Age"
                entry={prefill.demographics.age}
                renderValue={(v) => `${v} yrs`}
              />
              <PrefillRow
                label="Biological Sex"
                entry={prefill.demographics.biologicalSex}
              />
              <PrefillRow label="Ethnicity" entry={prefill.demographics.ethnicity} />
              <PrefillRow label="Race" entry={prefill.demographics.race} />
            </SectionCard>

            {/* 2. Medications */}
            <SectionCard title="Medications" icon="pills.fill">
              <PrefillRow
                label="Alpha Blockers"
                entry={prefill.medications.alphaBlockers}
                renderValue={(v) => v.map((m: { name: string }) => m.name).join(', ')}
              />
              <PrefillRow
                label="5-ARIs"
                entry={prefill.medications.fiveARIs}
                renderValue={(v) => v.map((m: { name: string }) => m.name).join(', ')}
              />
              <PrefillRow
                label="Anticholinergics"
                entry={prefill.medications.anticholinergics}
                renderValue={(v) => v.map((m: { name: string }) => m.name).join(', ')}
              />
              <PrefillRow
                label="Beta-3 Agonists"
                entry={prefill.medications.beta3Agonists}
                renderValue={(v) => v.map((m: { name: string }) => m.name).join(', ')}
              />
              <PrefillRow
                label="Other BPH"
                entry={prefill.medications.otherBPH}
                renderValue={(v) => v.map((m: { name: string }) => m.name).join(', ')}
              />
            </SectionCard>

            {/* 3. Surgical History */}
            <SectionCard title="Surgical History" icon="cross.case.fill">
              <PrefillRow
                label="BPH Procedures"
                entry={prefill.surgicalHistory.bphProcedures}
                renderValue={(v) => v.map((p: { name: string }) => p.name).join(', ')}
              />
              <PrefillRow
                label="Other Procedures"
                entry={prefill.surgicalHistory.otherProcedures}
                renderValue={(v) =>
                  `${v.length} procedure${v.length !== 1 ? 's' : ''}`
                }
              />
            </SectionCard>

            {/* 4. Labs */}
            <SectionCard title="Labs" icon="testtube.2">
              <PrefillRow
                label="PSA"
                entry={prefill.labs.psa}
                renderValue={(v) =>
                  `${v.value} ${v.unit}  (${(v.date as string).slice(0, 10)})`
                }
              />
              <PrefillRow
                label="HbA1c"
                entry={prefill.labs.hba1c}
                renderValue={(v) =>
                  `${v.value}${v.unit}  (${(v.date as string).slice(0, 10)})`
                }
              />
              <PrefillRow
                label="Urinalysis"
                entry={prefill.labs.urinalysis}
                renderValue={(v) =>
                  `${v.value} ${v.unit}  (${(v.date as string).slice(0, 10)})`
                }
              />
            </SectionCard>

            {/* 5. Conditions */}
            <SectionCard title="Conditions" icon="heart.text.square.fill">
              <PrefillRow
                label="Diabetes"
                entry={prefill.conditions.diabetes}
                renderValue={(v) =>
                  v.map((cond: { name: string }) => cond.name).join(', ')
                }
              />
              <PrefillRow
                label="Hypertension"
                entry={prefill.conditions.hypertension}
                renderValue={(v) =>
                  v.map((cond: { name: string }) => cond.name).join(', ')
                }
              />
              <PrefillRow
                label="BPH"
                entry={prefill.conditions.bph}
                renderValue={(v) =>
                  v.map((cond: { name: string }) => cond.name).join(', ')
                }
              />
              <PrefillRow
                label="Other"
                entry={prefill.conditions.other}
                renderValue={(v) =>
                  `${v.length} condition${v.length !== 1 ? 's' : ''}`
                }
              />
            </SectionCard>

            {/* 6. Clinical Measurements */}
            <SectionCard title="Clinical Measurements" icon="waveform.path.ecg">
              <PrefillRow
                label="PVR"
                entry={prefill.clinicalMeasurements.pvr}
                renderValue={(v) => `${v.value} ${v.unit}`}
              />
              <PrefillRow
                label="Uroflow Qmax"
                entry={prefill.clinicalMeasurements.uroflowQmax}
                renderValue={(v) => `${v.value} ${v.unit}`}
              />
              <PrefillRow
                label="Mobility"
                entry={prefill.clinicalMeasurements.mobility}
              />
            </SectionCard>

            {/* 7. Upcoming Surgery */}
            <SectionCard title="Upcoming Surgery" icon="calendar.badge.clock">
              <PrefillRow label="Date" entry={prefill.upcomingSurgery.date} />
              <PrefillRow label="Type" entry={prefill.upcomingSurgery.type} />
            </SectionCard>

            {/* Copy JSON button */}
            <TouchableOpacity
              style={[mainS.copyBtn, { backgroundColor: c.card }]}
              onPress={handleCopy}
              activeOpacity={0.7}
            >
              <IconSymbol name={'doc.on.doc.fill' as any} size={16} color={c.accent} />
              <Text style={[mainS.copyBtnText, { color: c.accent }]}>
                Copy Output JSON
              </Text>
            </TouchableOpacity>

            {/* Collapsible raw FHIR viewer */}
            <JsonViewer data={rawResources} />
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const mainS = StyleSheet.create({
  container: { flex: 1 },

  // Nav bar
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 60 },
  backText: { fontSize: 17 },
  navTitle: { fontSize: 17, fontWeight: '600' },

  // Dev banner
  devBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FF9F0A22',
    borderRadius: 10,
    paddingVertical: 8,
    marginBottom: 14,
  },
  devBannerText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FF9F0A',
    letterSpacing: 0.2,
  },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 12 },

  // Fixture card
  card: { borderRadius: 14, padding: 16, marginBottom: 12 },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  cardLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  // Fixture picker rows
  fixtureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    marginBottom: 8,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  fixtureLabel: { fontSize: 15, fontWeight: '500' },

  // Run button
  runBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 12,
    marginTop: 8,
  },
  runBtnText: { fontSize: 16, fontWeight: '600', color: '#FFF' },

  // Status
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  statusText: { fontSize: 13, fontWeight: '500' },
  errorDetail: { fontSize: 12, color: '#FF453A', marginTop: 4 },

  // Copy button
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 13,
    marginBottom: 12,
  },
  copyBtnText: { fontSize: 15, fontWeight: '600' },
});
