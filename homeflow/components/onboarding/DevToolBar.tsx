/**
 * Dev Tool Bar
 *
 * Development-only navigation bar for iterating through onboarding screens.
 * Provides Reset (red), Prev (yellow), and Continue (green) buttons.
 *
 * TODO: Remove before production release.
 */

import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useRouter, Href } from 'expo-router';
import { OnboardingStep, ONBOARDING_FLOW } from '@/lib/constants';
import { OnboardingService } from '@/lib/services/onboarding-service';

const STEP_TO_PATH: Record<OnboardingStep, string> = {
  [OnboardingStep.WELCOME]: '/(onboarding)/welcome',
  [OnboardingStep.CHAT]: '/(onboarding)/chat',
  [OnboardingStep.CONSENT]: '/(onboarding)/consent',
  [OnboardingStep.ACCOUNT]: '/(onboarding)/account',
  [OnboardingStep.PERMISSIONS]: '/(onboarding)/permissions',
  [OnboardingStep.HEALTH_DATA_TEST]: '/(onboarding)/health-data-test',
  [OnboardingStep.MEDICAL_HISTORY]: '/(onboarding)/medical-history',
  [OnboardingStep.BASELINE_SURVEY]: '/(onboarding)/baseline-survey',
  [OnboardingStep.COMPLETE]: '/(onboarding)/complete',
};

interface DevToolBarProps {
  currentStep: OnboardingStep;
  onContinue: () => void;
  extraActions?: { label: string; onPress: () => void; color?: string }[];
}

export function DevToolBar({ currentStep, onContinue, extraActions }: DevToolBarProps) {
  const router = useRouter();

  // Only render in development
  if (!__DEV__) return null;

  const currentIndex = ONBOARDING_FLOW.indexOf(currentStep);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < ONBOARDING_FLOW.length - 1;

  const handleReset = async () => {
    await OnboardingService.reset();
    await OnboardingService.start();
    if (router.canDismiss()) {
      router.dismissAll();
    }
    router.replace('/(onboarding)/welcome' as Href);
  };

  const handlePrev = async () => {
    if (!hasPrev) return;
    const prevStep = ONBOARDING_FLOW[currentIndex - 1];
    await OnboardingService.goToStep(prevStep);
    if (router.canDismiss()) {
      router.dismissAll();
    }
    router.replace(STEP_TO_PATH[prevStep] as Href);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Dev Tools</Text>
      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.button, styles.resetButton]}
          onPress={handleReset}
          activeOpacity={0.7}
        >
          <Text style={styles.buttonText}>Reset</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.prevButton, !hasPrev && styles.disabledButton]}
          onPress={handlePrev}
          disabled={!hasPrev}
          activeOpacity={0.7}
        >
          <Text style={[styles.buttonText, styles.darkText, !hasPrev && styles.disabledDarkText]}>
            Prev
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.continueButton, !hasNext && styles.disabledButton]}
          onPress={onContinue}
          disabled={!hasNext}
          activeOpacity={0.7}
        >
          <Text style={[styles.buttonText, !hasNext && styles.disabledText]}>Continue</Text>
        </TouchableOpacity>
      </View>
      {extraActions && extraActions.length > 0 && (
        <View style={styles.extraRow}>
          {extraActions.map((action, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.button, { backgroundColor: action.color || '#5856D6' }]}
              onPress={action.onPress}
              activeOpacity={0.7}
            >
              <Text style={styles.buttonText}>{action.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.15)',
    backgroundColor: 'rgba(0,0,0,0.03)',
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    color: '#999',
    textAlign: 'center',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  extraRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  button: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  resetButton: {
    backgroundColor: '#FF3B30',
  },
  prevButton: {
    backgroundColor: '#FFCC00',
  },
  continueButton: {
    backgroundColor: '#34C759',
  },
  disabledButton: {
    opacity: 0.35,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  darkText: {
    color: '#000000',
  },
  disabledText: {
    color: 'rgba(255,255,255,0.6)',
  },
  disabledDarkText: {
    color: 'rgba(0,0,0,0.4)',
  },
});
