/**
 * FHIR Parser Test Screen — Onboarding (DEV ONLY)
 *
 * Inserted between health-data-test and medical-history in the onboarding
 * flow. Loads local FHIR fixture bundles and runs the deterministic
 * lib/services/fhir parser, rendering the 7-section MedicalHistoryPrefill.
 *
 * Production: auto-skips to medical-history immediately.
 * Dev: shows full parser test UI with a Continue footer button.
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Alert,
  Share,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Href } from 'expo-router';
import { Colors, StanfordColors, Spacing } from '@/constants/theme';
import { useColorScheme } from 'react-native';
import { OnboardingStep } from '@/lib/constants';
import { OnboardingService } from '@/lib/services/onboarding-service';
import { ContinueButton, DevToolBar } from '@/components/onboarding';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { buildMedicalHistoryPrefill } from '@/lib/services/fhir';
import type {
  MedicalHistoryPrefill,
  PrefillEntry,
  ClinicalRecordsInput,
  HealthKitDemographics,
} from '@/lib/services/fhir';

// ── Fixtures — statically required so Metro bundles them ─────────────
// eslint-disable-next-line @typescript-eslint/no-require-imports
const FIXTURE_MAP = {
  'Patient A – Eli Rowan': require('@/assets/fhir-fixtures/patient_A.bundle.json'),
  'Patient B – Maya Navarro': require('@/assets/fhir-fixtures/patient_B.bundle.json'),
  'Patient C – Noah Kim': require('@/assets/fhir-fixtures/patient_C.bundle.json'),
} as const;

type FixtureKey = keyof typeof FIXTURE_MAP;
const FIXTURE_KEYS = Object.keys(FIXTURE_MAP) as FixtureKey[];

// ── Bundle adapter ────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeToResources(raw: any): any[] {
  if (raw?.resourceType === 'Bundle' && Array.isArray(raw.entry)) {
    return raw.entry
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((e: any) => e?.resource)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((r: any): r is Record<string, unknown> =>
        r != null && typeof r.resourceType === 'string',
      );
  }
  if (Array.isArray(raw?.resources)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (raw.resources as any[]).filter(Boolean);
  }
  if (raw?.resourceType) return [raw];
  return [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rawDisplayName(resource: any): string {
  const rt: string = resource.resourceType ?? '';
  if (rt === 'MedicationRequest' || rt === 'MedicationOrder' || rt === 'MedicationStatement') {
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

// ── Parse result ──────────────────────────────────────────────────────

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
  return { prefill, rawResources: resources, resourceCount: resources.length, durationMs: Date.now() - t0 };
}

// ── Confidence badge ──────────────────────────────────────────────────

const CONF_COLOR: Record<string, string> = {
  high: '#30D158',
  medium: '#FF9F0A',
  low: '#FF453A',
  none: '#8E8E93',
};

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const color = CONF_COLOR[confidence] ?? '#8E8E93';
  return (
    <View style={[badgeS.pill, { backgroundColor: color + '33' }]}>
      <Text style={[badgeS.text, { color }]}>{confidence}</Text>
    </View>
  );
}

const badgeS = StyleSheet.create({
  pill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  text: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
});

// ── Prefill row ───────────────────────────────────────────────────────

function PrefillRow({
  label,
  entry,
  renderValue,
  colors,
}: {
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entry: PrefillEntry<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renderValue?: (v: any) => string;
  colors: typeof Colors.light;
}) {
  const hasValue = entry.value != null;
  const displayValue = hasValue
    ? renderValue ? renderValue(entry.value) : String(entry.value)
    : '—';

  return (
    <View style={rowS.row}>
      <Text style={[rowS.label, { color: colors.icon }]}>{label}</Text>
      <View style={rowS.right}>
        <Text
          style={[rowS.value, { color: hasValue ? colors.text : colors.icon }, !hasValue && rowS.empty]}
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
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 7, gap: 8 },
  label: { fontSize: 14, flex: 1, paddingTop: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, maxWidth: '65%' },
  value: { fontSize: 14, fontWeight: '500', textAlign: 'right', flexShrink: 1 },
  empty: { fontStyle: 'italic' },
});

// ── Section card ──────────────────────────────────────────────────────

function SectionCard({
  title,
  icon,
  children,
  colorScheme,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
  colorScheme: string | null | undefined;
}) {
  const bg = colorScheme === 'dark' ? '#1C1C1E' : '#F8F8FA';
  return (
    <View style={[sCardS.card, { backgroundColor: bg }]}>
      <View style={sCardS.header}>
        <IconSymbol name={icon as any} size={14} color="#8E8E93" />
        <Text style={sCardS.title}>{title}</Text>
      </View>
      <View style={sCardS.divider} />
      {children}
    </View>
  );
}

const sCardS = StyleSheet.create({
  card: { borderRadius: 12, padding: 14, marginBottom: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 },
  title: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', color: '#8E8E93' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#3C3C4333', marginBottom: 6 },
});

// ── Collapsible JSON viewer ───────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function JsonViewer({ data, colorScheme }: { data: any; colorScheme: string | null | undefined }) {
  const [expanded, setExpanded] = useState(false);
  const json = JSON.stringify(data, null, 2);
  const count = Array.isArray(data) ? (data as unknown[]).length : null;
  const bg = colorScheme === 'dark' ? '#1C1C1E' : '#F8F8FA';

  return (
    <View style={[jsonS.card, { backgroundColor: bg }]}>
      <TouchableOpacity style={jsonS.toggleRow} onPress={() => setExpanded((v) => !v)} activeOpacity={0.7}>
        <IconSymbol name={(expanded ? 'chevron.up' : 'chevron.down') as any} size={14} color="#8E8E93" />
        <Text style={jsonS.toggleText}>
          {expanded ? 'Hide Raw FHIR Resources' : 'Show Raw FHIR Resources'}
        </Text>
        {count != null && (
          <Text style={jsonS.count}>{count} resource{count !== 1 ? 's' : ''}</Text>
        )}
      </TouchableOpacity>
      {expanded && (
        <ScrollView style={jsonS.scrollBox} nestedScrollEnabled showsVerticalScrollIndicator>
          <Text style={jsonS.jsonText}>{json}</Text>
        </ScrollView>
      )}
    </View>
  );
}

const jsonS = StyleSheet.create({
  card: { borderRadius: 12, padding: 14, marginBottom: 10 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toggleText: { fontSize: 15, fontWeight: '500', flex: 1, color: '#007AFF' },
  count: { fontSize: 12, color: '#8E8E93' },
  scrollBox: { maxHeight: 360, marginTop: 12, backgroundColor: '#1A1A2E', borderRadius: 10, padding: 12 },
  jsonText: { fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: '#A5D6A7', lineHeight: 16 },
});

// ── Run state ─────────────────────────────────────────────────────────

type RunState =
  | { status: 'idle' }
  | { status: 'success'; result: ParseResult }
  | { status: 'error'; message: string };

// ── Main screen ───────────────────────────────────────────────────────

export default function FhirParserTestOnboarding() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  // Production: auto-skip this screen
  useEffect(() => {
    if (!__DEV__) {
      (async () => {
        await OnboardingService.goToStep(OnboardingStep.MEDICAL_HISTORY);
        router.replace('/(onboarding)/medical-history' as Href);
      })();
    }
  }, [router]);

  const handleContinue = useCallback(async () => {
    await OnboardingService.goToStep(OnboardingStep.MEDICAL_HISTORY);
    router.push('/(onboarding)/medical-history' as Href);
  }, [router]);

  const [selectedFixture, setSelectedFixture] = useState<FixtureKey>(FIXTURE_KEYS[0]);
  const [runState, setRunState] = useState<RunState>({ status: 'idle' });

  const handleRun = useCallback(() => {
    try {
      const result = runParser(selectedFixture);
      setRunState({ status: 'success', result });
    } catch (err) {
      setRunState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, [selectedFixture]);

  const handleCopy = useCallback(async () => {
    if (runState.status !== 'success') return;
    const json = JSON.stringify(runState.result.prefill, null, 2);
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Clipboard = require('expo-clipboard');
      await (Clipboard.setStringAsync as (s: string) => Promise<void>)(json);
      Alert.alert('Copied', 'Prefill output JSON copied to clipboard.');
    } catch {
      try { await Share.share({ message: json }); } catch { /* no-op */ }
    }
  }, [runState]);

  // Don't render test UI in production
  if (!__DEV__) {
    return (
      <SafeAreaView style={[s.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={StanfordColors.cardinal} />
      </SafeAreaView>
    );
  }

  const prefill = runState.status === 'success' ? runState.result.prefill : null;
  const rawResources = runState.status === 'success' ? runState.result.rawResources : [];
  const isDark = colorScheme === 'dark';
  const cardBg = isDark ? '#1C1C1E' : '#F8F8FA';

  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={s.titleRow}>
          <IconSymbol name={'doc.text.magnifyingglass' as any} size={28} color={StanfordColors.cardinal} />
          <Text style={[s.title, { color: colors.text }]}>FHIR Parser Test</Text>
        </View>
        <Text style={[s.subtitle, { color: colors.icon }]}>
          Dev-only screen. Select a fixture and run the medical history parser.
        </Text>

        {/* Dev banner */}
        <View style={s.devBanner}>
          <IconSymbol name={'hammer.fill' as any} size={13} color="#FF9F0A" />
          <Text style={s.devBannerText}>DEV ONLY — skipped in production builds</Text>
        </View>

        {/* Fixture selector */}
        <View style={[s.card, { backgroundColor: cardBg }]}>
          <Text style={s.sectionHeader}>Select Fixture</Text>

          {FIXTURE_KEYS.map((key) => {
            const active = selectedFixture === key;
            return (
              <TouchableOpacity
                key={key}
                style={[
                  s.fixtureRow,
                  {
                    borderColor: active ? StanfordColors.cardinal : 'transparent',
                    backgroundColor: active
                      ? StanfordColors.cardinal + '18'
                      : isDark ? '#2C2C2E' : '#EFEFEF',
                  },
                ]}
                onPress={() => setSelectedFixture(key)}
                activeOpacity={0.7}
              >
                <View style={[s.radio, { borderColor: active ? StanfordColors.cardinal : '#8E8E93' }]}>
                  {active && <View style={[s.radioDot, { backgroundColor: StanfordColors.cardinal }]} />}
                </View>
                <Text style={[s.fixtureLabel, { color: colors.text }]}>{key}</Text>
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity
            style={[s.runBtn, { backgroundColor: StanfordColors.cardinal }]}
            onPress={handleRun}
            activeOpacity={0.8}
          >
            <IconSymbol name={'play.fill' as any} size={14} color="#FFF" />
            <Text style={s.runBtnText}>Run Parser</Text>
          </TouchableOpacity>

          {runState.status === 'success' && (
            <View style={s.statusRow}>
              <IconSymbol name={'checkmark.circle.fill' as any} size={15} color="#30D158" />
              <Text style={[s.statusText, { color: '#30D158' }]}>
                Parsed in {runState.result.durationMs} ms · {runState.result.resourceCount} resources
              </Text>
            </View>
          )}
          {runState.status === 'error' && (
            <>
              <View style={s.statusRow}>
                <IconSymbol name={'xmark.circle.fill' as any} size={15} color="#FF453A" />
                <Text style={[s.statusText, { color: '#FF453A' }]}>Parse error</Text>
              </View>
              <Text style={s.errorDetail}>{runState.message}</Text>
            </>
          )}
        </View>

        {/* Prefill output */}
        {prefill && (
          <>
            {/* 1. Demographics */}
            <SectionCard title="Demographics" icon="person.fill" colorScheme={colorScheme}>
              <PrefillRow label="Full Name" entry={prefill.demographics.fullName} colors={colors} />
              <PrefillRow label="Age" entry={prefill.demographics.age} renderValue={(v) => `${v} yrs`} colors={colors} />
              <PrefillRow label="Biological Sex" entry={prefill.demographics.biologicalSex} colors={colors} />
              <PrefillRow label="Ethnicity" entry={prefill.demographics.ethnicity} colors={colors} />
              <PrefillRow label="Race" entry={prefill.demographics.race} colors={colors} />
            </SectionCard>

            {/* 2. Medications */}
            <SectionCard title="Medications" icon="pills.fill" colorScheme={colorScheme}>
              <PrefillRow label="Alpha Blockers" entry={prefill.medications.alphaBlockers} renderValue={(v) => v.map((m: { name: string }) => m.name).join(', ')} colors={colors} />
              <PrefillRow label="5-ARIs" entry={prefill.medications.fiveARIs} renderValue={(v) => v.map((m: { name: string }) => m.name).join(', ')} colors={colors} />
              <PrefillRow label="Anticholinergics" entry={prefill.medications.anticholinergics} renderValue={(v) => v.map((m: { name: string }) => m.name).join(', ')} colors={colors} />
              <PrefillRow label="Beta-3 Agonists" entry={prefill.medications.beta3Agonists} renderValue={(v) => v.map((m: { name: string }) => m.name).join(', ')} colors={colors} />
              <PrefillRow label="Other BPH" entry={prefill.medications.otherBPH} renderValue={(v) => v.map((m: { name: string }) => m.name).join(', ')} colors={colors} />
            </SectionCard>

            {/* 3. Surgical History */}
            <SectionCard title="Surgical History" icon="cross.case.fill" colorScheme={colorScheme}>
              <PrefillRow label="BPH Procedures" entry={prefill.surgicalHistory.bphProcedures} renderValue={(v) => v.map((p: { name: string }) => p.name).join(', ')} colors={colors} />
              <PrefillRow label="Other Procedures" entry={prefill.surgicalHistory.otherProcedures} renderValue={(v) => `${v.length} procedure${v.length !== 1 ? 's' : ''}`} colors={colors} />
            </SectionCard>

            {/* 4. Labs */}
            <SectionCard title="Labs" icon="testtube.2" colorScheme={colorScheme}>
              <PrefillRow label="PSA" entry={prefill.labs.psa} renderValue={(v) => `${v.value} ${v.unit} (${(v.date as string).slice(0, 10)})`} colors={colors} />
              <PrefillRow label="HbA1c" entry={prefill.labs.hba1c} renderValue={(v) => `${v.value}${v.unit} (${(v.date as string).slice(0, 10)})`} colors={colors} />
              <PrefillRow label="Urinalysis" entry={prefill.labs.urinalysis} renderValue={(v) => `${v.value} ${v.unit} (${(v.date as string).slice(0, 10)})`} colors={colors} />
            </SectionCard>

            {/* 5. Conditions */}
            <SectionCard title="Conditions" icon="heart.text.square.fill" colorScheme={colorScheme}>
              <PrefillRow label="Diabetes" entry={prefill.conditions.diabetes} renderValue={(v) => v.map((c: { name: string }) => c.name).join(', ')} colors={colors} />
              <PrefillRow label="Hypertension" entry={prefill.conditions.hypertension} renderValue={(v) => v.map((c: { name: string }) => c.name).join(', ')} colors={colors} />
              <PrefillRow label="BPH" entry={prefill.conditions.bph} renderValue={(v) => v.map((c: { name: string }) => c.name).join(', ')} colors={colors} />
              <PrefillRow label="Other" entry={prefill.conditions.other} renderValue={(v) => `${v.length} condition${v.length !== 1 ? 's' : ''}`} colors={colors} />
            </SectionCard>

            {/* 6. Clinical Measurements */}
            <SectionCard title="Clinical Measurements" icon="waveform.path.ecg" colorScheme={colorScheme}>
              <PrefillRow label="PVR" entry={prefill.clinicalMeasurements.pvr} renderValue={(v) => `${v.value} ${v.unit}`} colors={colors} />
              <PrefillRow label="Uroflow Qmax" entry={prefill.clinicalMeasurements.uroflowQmax} renderValue={(v) => `${v.value} ${v.unit}`} colors={colors} />
              <PrefillRow label="Mobility" entry={prefill.clinicalMeasurements.mobility} colors={colors} />
            </SectionCard>

            {/* 7. Upcoming Surgery */}
            <SectionCard title="Upcoming Surgery" icon="calendar.badge.clock" colorScheme={colorScheme}>
              <PrefillRow label="Date" entry={prefill.upcomingSurgery.date} colors={colors} />
              <PrefillRow label="Type" entry={prefill.upcomingSurgery.type} colors={colors} />
            </SectionCard>

            {/* Copy JSON */}
            <TouchableOpacity
              style={[s.copyBtn, { backgroundColor: cardBg }]}
              onPress={handleCopy}
              activeOpacity={0.7}
            >
              <IconSymbol name={'doc.on.doc.fill' as any} size={16} color="#007AFF" />
              <Text style={s.copyBtnText}>Copy Output JSON</Text>
            </TouchableOpacity>

            {/* Raw FHIR */}
            <JsonViewer data={rawResources} colorScheme={colorScheme} />
          </>
        )}

        <View style={{ height: 20 }} />
      </ScrollView>

      {/* Footer */}
      <View style={[s.footer, { borderTopColor: isDark ? '#38383A' : '#E5E5EA' }]}>
        <ContinueButton title="Continue to Medical History" onPress={handleContinue} />
      </View>

      <DevToolBar
        currentStep={OnboardingStep.HEALTH_DATA_TEST}
        onContinue={handleContinue}
      />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { padding: Spacing.screenHorizontal, paddingBottom: 40 },

  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: Spacing.xs, marginTop: Spacing.sm },
  title: { fontSize: 26, fontWeight: '700' },
  subtitle: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: Spacing.md },

  devBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, backgroundColor: '#FF9F0A22', borderRadius: 10,
    paddingVertical: 8, marginBottom: Spacing.md,
  },
  devBannerText: { fontSize: 12, fontWeight: '600', color: '#FF9F0A', letterSpacing: 0.2 },

  card: { borderRadius: 12, padding: 14, marginBottom: 12 },
  sectionHeader: { fontSize: 13, fontWeight: '700', color: '#8E8E93', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 12 },

  fixtureRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: 10, borderWidth: 1.5, marginBottom: 8,
  },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  fixtureLabel: { fontSize: 15, fontWeight: '500' },

  runBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: 12, marginTop: 8 },
  runBtnText: { fontSize: 16, fontWeight: '600', color: '#FFF' },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  statusText: { fontSize: 13, fontWeight: '500' },
  errorDetail: { fontSize: 12, color: '#FF453A', marginTop: 4 },

  copyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, paddingVertical: 13, marginBottom: 10 },
  copyBtnText: { fontSize: 15, fontWeight: '600', color: '#007AFF' },

  footer: { padding: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: StyleSheet.hairlineWidth },
});
