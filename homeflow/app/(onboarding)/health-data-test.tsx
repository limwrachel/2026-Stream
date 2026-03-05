/**
 * Health Data Test Screen (Dev Only)
 *
 * Sits between Permissions and Medical History in the onboarding flow.
 * In production (__DEV__ === false), auto-skips to medical history.
 * In dev mode, shows a full testing UI for HealthKit + Clinical Records queries.
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  useColorScheme,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useRouter, Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, StanfordColors, Spacing } from '@/constants/theme';
import { OnboardingStep } from '@/lib/constants';
import { OnboardingService } from '@/lib/services/onboarding-service';
import {
  OnboardingProgressBar,
  ContinueButton,
  DevToolBar,
} from '@/components/onboarding';
import { IconSymbol } from '@/components/ui/icon-symbol';

import {
  requestHealthPermissions,
  getDailyActivity,
  getSleep,
  getVitals,
  areClinicalRecordsAvailable,
  requestClinicalPermissions,
  getClinicalMedications,
  getClinicalLabResults,
  getClinicalConditions,
  getClinicalProcedures,
} from '@/lib/services/healthkit';
import type { DateRange } from '@/lib/services/healthkit';

// ── Types ───────────────────────────────────────────────────────────

type TestStatus = 'idle' | 'running' | 'success' | 'error';

interface TestResult {
  label: string;
  status: TestStatus;
  data?: unknown;
  error?: string;
  count?: number;
}

// ── Helpers ─────────────────────────────────────────────────────────

function getLast7DaysRange(): DateRange {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 7);
  return { startDate: start, endDate: end };
}

function truncateJSON(obj: unknown, maxLength = 500): string {
  const str = JSON.stringify(obj, null, 2);
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + '\n... (truncated)';
}

// ── Main Screen ─────────────────────────────────────────────────────

export default function HealthDataTestScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  // In production, auto-skip this screen
  useEffect(() => {
    if (!__DEV__) {
      (async () => {
        await OnboardingService.goToStep(OnboardingStep.MEDICAL_HISTORY);
        router.replace('/(onboarding)/medical-history' as Href);
      })();
    }
  }, [router]);

  const handleContinue = async () => {
    if (__DEV__) {
      // In dev builds, proceed to the FHIR parser test screen next
      router.push('/(onboarding)/fhir-parser-test' as Href);
    } else {
      await OnboardingService.goToStep(OnboardingStep.MEDICAL_HISTORY);
      router.push('/(onboarding)/medical-history' as Href);
    }
  };

  // Don't render test UI in production
  if (!__DEV__) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={StanfordColors.cardinal} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <OnboardingProgressBar currentStep={OnboardingStep.HEALTH_DATA_TEST} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.titleContainer}>
          <IconSymbol name={'stethoscope' as any} size={28} color={StanfordColors.cardinal} />
          <Text style={[styles.title, { color: colors.text }]}>
            Health Data Test
          </Text>
        </View>

        <Text style={[styles.subtitle, { color: colors.icon }]}>
          Dev-only screen. Test HealthKit and Clinical Records queries before proceeding.
        </Text>

        <StatusBanner colors={colors} colorScheme={colorScheme} />

        <SectionHeader title="HealthKit Permissions" colors={colors} />
        <PermissionTests colors={colors} colorScheme={colorScheme} />

        <SectionHeader title="HealthKit Data (Last 7 Days)" colors={colors} />
        <HealthKitTests colors={colors} colorScheme={colorScheme} />

        <SectionHeader title="Clinical Records (FHIR)" colors={colors} />
        <ClinicalRecordTests colors={colors} colorScheme={colorScheme} />
      </ScrollView>

      <View style={styles.footer}>
        <ContinueButton
          title="Continue to Medical History"
          onPress={handleContinue}
        />
      </View>

      <DevToolBar
        currentStep={OnboardingStep.HEALTH_DATA_TEST}
        onContinue={handleContinue}
      />
    </SafeAreaView>
  );
}

// ── Status Banner ───────────────────────────────────────────────────

function StatusBanner({
  colors,
  colorScheme,
}: {
  colors: typeof Colors.light;
  colorScheme: string | null | undefined;
}) {
  const isIOS = Platform.OS === 'ios';
  const clinicalAvailable = isIOS ? areClinicalRecordsAvailable() : false;

  return (
    <View
      style={[
        styles.banner,
        { backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#F2F2F7' },
      ]}
    >
      <StatusRow label="Platform" value={Platform.OS} />
      <StatusRow label="HealthKit Available" value={isIOS ? 'Yes' : 'No'} />
      <StatusRow
        label="Clinical Records Available"
        value={clinicalAvailable ? 'Yes' : 'No'}
      />
    </View>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statusRow}>
      <Text style={styles.statusLabel}>{label}</Text>
      <Text
        style={[
          styles.statusValue,
          { color: value === 'Yes' ? '#34C759' : value === 'No' ? '#FF3B30' : '#007AFF' },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

// ── Section Header ──────────────────────────────────────────────────

function SectionHeader({
  title,
  colors,
}: {
  title: string;
  colors: typeof Colors.light;
}) {
  return (
    <Text style={[styles.sectionHeader, { color: colors.text }]}>{title}</Text>
  );
}

// ── Permission Tests ────────────────────────────────────────────────

function PermissionTests({
  colors,
  colorScheme,
}: {
  colors: typeof Colors.light;
  colorScheme: string | null | undefined;
}) {
  const [hkResult, setHkResult] = useState<TestResult>({
    label: 'Request HealthKit Permissions',
    status: 'idle',
  });
  const [crResult, setCrResult] = useState<TestResult>({
    label: 'Request Clinical Records Permissions',
    status: 'idle',
  });

  const handleHKPermissions = useCallback(async () => {
    setHkResult((prev) => ({ ...prev, status: 'running' }));
    try {
      const result = await requestHealthPermissions();
      setHkResult({
        label: 'Request HealthKit Permissions',
        status: result.success ? 'success' : 'error',
        data: result,
        error: result.success ? undefined : result.note,
      });
    } catch (e) {
      setHkResult({
        label: 'Request HealthKit Permissions',
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  const handleCRPermissions = useCallback(async () => {
    setCrResult((prev) => ({ ...prev, status: 'running' }));
    try {
      const result = await requestClinicalPermissions();
      setCrResult({
        label: 'Request Clinical Records Permissions',
        status: result.success ? 'success' : 'error',
        data: result,
        error: result.success ? undefined : result.note,
      });
    } catch (e) {
      setCrResult({
        label: 'Request Clinical Records Permissions',
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  return (
    <View>
      <TestButton result={hkResult} onPress={handleHKPermissions} colors={colors} colorScheme={colorScheme} />
      <TestButton result={crResult} onPress={handleCRPermissions} colors={colors} colorScheme={colorScheme} />
    </View>
  );
}

// ── HealthKit Data Tests ────────────────────────────────────────────

function HealthKitTests({
  colors,
  colorScheme,
}: {
  colors: typeof Colors.light;
  colorScheme: string | null | undefined;
}) {
  const [results, setResults] = useState<TestResult[]>([
    { label: 'Daily Activity', status: 'idle' },
    { label: 'Sleep', status: 'idle' },
    { label: 'Vitals', status: 'idle' },
  ]);

  const runTest = useCallback(
    async (index: number, fn: (range: DateRange) => Promise<unknown>, label: string) => {
      setResults((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], status: 'running' };
        return next;
      });
      try {
        const range = getLast7DaysRange();
        const data = await fn(range);
        const count = Array.isArray(data) ? data.length : undefined;
        setResults((prev) => {
          const next = [...prev];
          next[index] = { label, status: 'success', data, count };
          return next;
        });
      } catch (e) {
        setResults((prev) => {
          const next = [...prev];
          next[index] = { label, status: 'error', error: e instanceof Error ? e.message : String(e) };
          return next;
        });
      }
    },
    [],
  );

  const handleRunAll = useCallback(async () => {
    await Promise.all([
      runTest(0, getDailyActivity, 'Daily Activity'),
      runTest(1, getSleep, 'Sleep'),
      runTest(2, getVitals, 'Vitals'),
    ]);
  }, [runTest]);

  return (
    <View>
      <RunAllButton onPress={handleRunAll} label="Fetch All HealthKit Data" />
      {results.map((r, i) => (
        <TestResultCard key={r.label} result={r} colors={colors} colorScheme={colorScheme} />
      ))}
    </View>
  );
}

// ── Clinical Record Tests ───────────────────────────────────────────

function ClinicalRecordTests({
  colors,
  colorScheme,
}: {
  colors: typeof Colors.light;
  colorScheme: string | null | undefined;
}) {
  const [results, setResults] = useState<TestResult[]>([
    { label: 'Medications', status: 'idle' },
    { label: 'Lab Results', status: 'idle' },
    { label: 'Conditions', status: 'idle' },
    { label: 'Procedures', status: 'idle' },
  ]);

  const runTest = useCallback(
    async (index: number, fn: () => Promise<unknown>, label: string) => {
      setResults((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], status: 'running' };
        return next;
      });
      try {
        const data = await fn();
        const count = Array.isArray(data) ? data.length : undefined;
        setResults((prev) => {
          const next = [...prev];
          next[index] = { label, status: 'success', data, count };
          return next;
        });
      } catch (e) {
        setResults((prev) => {
          const next = [...prev];
          next[index] = { label, status: 'error', error: e instanceof Error ? e.message : String(e) };
          return next;
        });
      }
    },
    [],
  );

  const handleRunAll = useCallback(async () => {
    await Promise.all([
      runTest(0, getClinicalMedications, 'Medications'),
      runTest(1, getClinicalLabResults, 'Lab Results'),
      runTest(2, getClinicalConditions, 'Conditions'),
      runTest(3, getClinicalProcedures, 'Procedures'),
    ]);
  }, [runTest]);

  return (
    <View>
      <RunAllButton onPress={handleRunAll} label="Fetch All Clinical Records" />
      {results.map((r) => (
        <TestResultCard key={r.label} result={r} colors={colors} colorScheme={colorScheme} />
      ))}
    </View>
  );
}

// ── Shared UI Components ────────────────────────────────────────────

function TestButton({
  result,
  onPress,
  colors,
  colorScheme,
}: {
  result: TestResult;
  onPress: () => void;
  colors: typeof Colors.light;
  colorScheme: string | null | undefined;
}) {
  const statusIcon =
    result.status === 'success' ? 'checkmark.circle.fill' :
    result.status === 'error' ? 'xmark.circle.fill' :
    result.status === 'running' ? 'arrow.clockwise' :
    'play.circle.fill';

  const statusColor =
    result.status === 'success' ? '#34C759' :
    result.status === 'error' ? '#FF3B30' :
    result.status === 'running' ? '#FF9500' :
    '#007AFF';

  return (
    <View style={styles.testButtonContainer}>
      <TouchableOpacity
        style={[
          styles.testButton,
          { backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#F8F8FA' },
        ]}
        onPress={onPress}
        disabled={result.status === 'running'}
        activeOpacity={0.7}
      >
        <IconSymbol name={statusIcon as any} size={22} color={statusColor} />
        <Text style={[styles.testButtonLabel, { color: colors.text }]}>
          {result.label}
        </Text>
        {result.status === 'running' && (
          <ActivityIndicator size="small" color="#FF9500" />
        )}
      </TouchableOpacity>
      {result.error && (
        <Text style={styles.errorText}>{result.error}</Text>
      )}
      {result.status === 'success' && result.data && (
        <Text style={styles.successNote}>
          {JSON.stringify(result.data)}
        </Text>
      )}
    </View>
  );
}

function TestResultCard({
  result,
  colors,
  colorScheme,
}: {
  result: TestResult;
  colors: typeof Colors.light;
  colorScheme: string | null | undefined;
}) {
  const [expanded, setExpanded] = useState(false);

  const statusColor =
    result.status === 'success' ? '#34C759' :
    result.status === 'error' ? '#FF3B30' :
    result.status === 'running' ? '#FF9500' :
    '#8E8E93';

  const statusText =
    result.status === 'success' && result.count !== undefined
      ? `${result.count} record${result.count !== 1 ? 's' : ''}`
      : result.status === 'running' ? 'Fetching...'
      : result.status === 'error' ? 'Error'
      : 'Not run';

  return (
    <View
      style={[
        styles.resultCard,
        { backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#F8F8FA' },
      ]}
    >
      <TouchableOpacity
        style={styles.resultCardHeader}
        onPress={() => result.data && setExpanded(!expanded)}
        activeOpacity={result.data ? 0.7 : 1}
      >
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        <Text style={[styles.resultLabel, { color: colors.text }]}>
          {result.label}
        </Text>
        {result.status === 'running' && (
          <ActivityIndicator size="small" color="#FF9500" />
        )}
        <Text style={[styles.resultStatus, { color: statusColor }]}>
          {statusText}
        </Text>
        {result.data && (
          <IconSymbol
            name={(expanded ? 'chevron.up' : 'chevron.down') as any}
            size={14}
            color={colors.icon}
          />
        )}
      </TouchableOpacity>

      {result.error && (
        <Text style={styles.errorText}>{result.error}</Text>
      )}

      {expanded && result.data && (
        <View style={styles.jsonContainer}>
          <Text style={styles.jsonText}>
            {truncateJSON(result.data, 2000)}
          </Text>
        </View>
      )}
    </View>
  );
}

function RunAllButton({ onPress, label }: { onPress: () => void; label: string }) {
  return (
    <TouchableOpacity
      style={styles.runAllButton}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <IconSymbol name={'play.fill' as any} size={14} color="#FFFFFF" />
      <Text style={styles.runAllLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Styles ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingTop: Spacing.sm },
  scrollView: { flex: 1 },
  scrollContent: { padding: Spacing.screenHorizontal, paddingBottom: 40 },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: Spacing.xs,
    marginTop: Spacing.md,
  },
  title: { fontSize: 26, fontWeight: '700' },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  banner: {
    borderRadius: 12,
    padding: 14,
    marginBottom: Spacing.lg,
    gap: 8,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusLabel: {
    fontSize: 14,
    color: '#8E8E93',
    fontWeight: '500',
  },
  statusValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  sectionHeader: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  testButtonContainer: {
    marginBottom: 10,
  },
  testButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    gap: 12,
  },
  testButtonLabel: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },
  resultCard: {
    borderRadius: 12,
    marginBottom: 8,
    overflow: 'hidden',
  },
  resultCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 10,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  resultLabel: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },
  resultStatus: {
    fontSize: 13,
    fontWeight: '500',
  },
  errorText: {
    fontSize: 12,
    color: '#FF3B30',
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  successNote: {
    fontSize: 11,
    color: '#34C759',
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  jsonContainer: {
    backgroundColor: '#1A1A2E',
    marginHorizontal: 10,
    marginBottom: 10,
    borderRadius: 8,
    padding: 12,
  },
  jsonText: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: '#A5D6A7',
    lineHeight: 16,
  },
  runAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#007AFF',
    borderRadius: 10,
    paddingVertical: 10,
    marginBottom: 12,
  },
  runAllLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  footer: {
    padding: Spacing.md,
    paddingBottom: Spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
});
