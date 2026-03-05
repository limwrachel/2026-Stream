import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { OnboardingService } from '@/lib/services/onboarding-service';
import { notifyOnboardingComplete } from '@/hooks/use-onboarding-status';
import { useSurgeryDate } from '@/hooks/use-surgery-date';
import { useWatchUsage } from '@/hooks/use-watch-usage';
import { SurgeryCompleteModal } from '@/components/home/SurgeryCompleteModal';
import { useAppTheme } from '@/lib/theme/ThemeContext';

export default function HomeScreen() {
  const { theme } = useAppTheme();
  const { isDark, colors: t } = theme;
  const surgery = useSurgeryDate();
  const watch = useWatchUsage();
  const [showSurgeryModal, setShowSurgeryModal] = useState(false);
  const [showDevSheet, setShowDevSheet] = useState(false);
  const [watchDismissed, setWatchDismissed] = useState(false);

  const handleResetOnboarding = () => {
    Alert.alert(
      'Reset Onboarding?',
      'This will clear all onboarding progress and restart from the beginning.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            try {
              await OnboardingService.reset();
              notifyOnboardingComplete();
            } catch (error) {
              console.error('Error resetting onboarding:', error);
              Alert.alert('Error', 'Failed to reset onboarding');
            }
          },
        },
      ],
    );
  };

  const showWatchReminder = !watch.isLoading && !watch.watchWornRecently && !watchDismissed;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: t.background }]} edges={['top']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header — Apple Health style: date above, large title below */}
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={[styles.dateLabel, { color: t.textTertiary }]}>
              {new Date().toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </Text>
            <Text style={[styles.greetingNormal, { color: t.textPrimary }]}>
              Welcome to
            </Text>
            <Text style={[styles.greeting, { color: t.textPrimary }]}>
              StreamSync
            </Text>
          </View>
          {__DEV__ && (
            <TouchableOpacity
              style={[styles.devPill, { backgroundColor: t.secondaryFill }]}
              onPress={() => setShowDevSheet(true)}
              activeOpacity={0.7}
            >
              <IconSymbol name="wrench.fill" size={13} color={t.textTertiary} />
              <Text style={[styles.devPillText, { color: t.textTertiary }]}>Dev</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Surgery Date Card */}
        <View style={[styles.card, styles.accentBorder, { backgroundColor: t.card, borderLeftColor: t.accent }]}>
          <View style={styles.cardHeader}>
            <IconSymbol name="calendar.badge.clock" size={17} color={t.accent} />
            <Text style={[styles.cardLabel, { color: t.textSecondary }]}>
              Surgery date
            </Text>
            {surgery.isPlaceholder && __DEV__ && (
              <View style={[styles.placeholderBadge, { backgroundColor: t.secondaryFill }]}>
                <Text style={[styles.placeholderBadgeText, { color: t.textTertiary }]}>
                  Placeholder
                </Text>
              </View>
            )}
          </View>
          {surgery.isLoading ? (
            <Text style={[styles.cardValue, { color: t.textPrimary }]}>Loading...</Text>
          ) : (
            <>
              <Text style={[styles.cardValue, { color: t.textPrimary }]}>
                {surgery.dateLabel}
              </Text>
              {surgery.date && !surgery.hasPassed && (
                <Text style={[styles.cardSubtext, { color: t.textTertiary }]}>
                  {daysUntil(surgery.date)}
                </Text>
              )}
              {surgery.hasPassed && (
                <Text style={[styles.cardSubtext, { color: t.textTertiary }]}>
                  Surgery completed — tracking recovery
                </Text>
              )}
            </>
          )}
        </View>

        {/* Study Timeline Card */}
        {!surgery.isLoading && (
          <View style={[styles.card, styles.accentBorder, { backgroundColor: t.card, borderLeftColor: t.semanticSuccess }]}>
            <View style={styles.cardHeader}>
              <IconSymbol name="calendar" size={17} color={t.semanticSuccess} />
              <Text style={[styles.cardLabel, { color: t.textSecondary }]}>
                Study timeline
              </Text>
              {surgery.isPlaceholder && __DEV__ && (
                <View style={[styles.placeholderBadge, { backgroundColor: t.secondaryFill }]}>
                  <Text style={[styles.placeholderBadgeText, { color: t.textTertiary }]}>
                    Placeholder
                  </Text>
                </View>
              )}
            </View>
            <View style={styles.timelineRow}>
              <View style={styles.timelineItem}>
                <Text style={[styles.timelineLabel, { color: t.textTertiary }]}>
                  Start
                </Text>
                <Text style={[styles.timelineValue, { color: t.textPrimary }]}>
                  {surgery.studyStartLabel}
                </Text>
              </View>
              <View style={[styles.timelineDivider, { backgroundColor: t.separator }]} />
              <View style={styles.timelineItem}>
                <Text style={[styles.timelineLabel, { color: t.textTertiary }]}>
                  End
                </Text>
                <Text style={[styles.timelineValue, { color: t.textPrimary }]}>
                  {surgery.studyEndLabel}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Watch Reminder */}
        {showWatchReminder && (
          <View style={[styles.reminderCard, { backgroundColor: t.card }]}>
            <View style={styles.reminderContent}>
              <IconSymbol name="applewatch" size={20} color={t.semanticSuccess} />
              <View style={styles.reminderTextContainer}>
                <Text style={[styles.reminderTitle, { color: t.textPrimary }]}>
                  Wear your Apple Watch today
                </Text>
                <Text style={[styles.reminderBody, { color: t.textTertiary }]}>
                  We use watch data to track your activity and sleep patterns.
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setWatchDismissed(true)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <IconSymbol name="xmark" size={13} color={t.textTertiary} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Watch all set */}
        {!watch.isLoading && watch.watchWornRecently && (
          <View style={[styles.allSetCard, { backgroundColor: t.card }]}>
            <IconSymbol name="checkmark.circle.fill" size={18} color={t.semanticSuccess} />
            <Text style={[styles.allSetText, { color: t.textPrimary }]}>
              Apple Watch data is syncing — all set
            </Text>
          </View>
        )}

        {/* Recovery Instructions card — shown after surgery */}
        {surgery.hasPassed && (
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={() => router.push('/(tabs)/recovery')}
            style={[styles.card, styles.accentBorder, { backgroundColor: t.card, borderLeftColor: t.accent }]}
          >
            <View style={styles.cardHeader}>
              <IconSymbol name="heart.fill" size={17} color={t.accent} />
              <Text style={[styles.cardLabel, { color: t.textSecondary }]}>Recovery plan</Text>
              <IconSymbol name="chevron.right" size={13} color={t.textTertiary} style={{ marginLeft: 'auto' }} />
            </View>
            <Text style={[styles.cardValue, { color: t.textPrimary }]}>
              Your Recovery Plan
            </Text>
            <Text style={[styles.cardSubtext, { color: t.textTertiary }]}>
              Stanford discharge instructions · tap to review
            </Text>
          </TouchableOpacity>
        )}

        {/* Study info */}
        <View style={[styles.card, styles.accentBorder, { backgroundColor: t.card, borderLeftColor: isDark ? '#BF5AF2' : '#AF52DE' }]}>
          <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>
            Your Study
          </Text>
          <Text style={[styles.studyBody, { color: t.textSecondary }]}>
            Track your BPH symptoms, voiding patterns, and recovery progress
            throughout the study. Your daily data helps your care team
            understand your health patterns.
          </Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Surgery Complete Modal */}
      <SurgeryCompleteModal
        visible={showSurgeryModal}
        onDismiss={() => setShowSurgeryModal(false)}
      />

      {/* Dev Tools Sheet */}
      {__DEV__ && (
        <Modal
          visible={showDevSheet}
          animationType="slide"
          transparent
          onRequestClose={() => setShowDevSheet(false)}
        >
          <Pressable style={styles.sheetOverlay} onPress={() => setShowDevSheet(false)}>
            <Pressable
              style={[styles.sheetContent, { backgroundColor: t.card }]}
              onPress={() => {}}
            >
              <View style={styles.sheetHandle} />
              <Text style={[styles.sheetTitle, { color: t.textTertiary }]}>
                Developer Tools
              </Text>

              <TouchableOpacity
                style={[styles.sheetButton, { backgroundColor: t.background }]}
                onPress={() => {
                  setShowDevSheet(false);
                  setTimeout(() => setShowSurgeryModal(true), 300);
                }}
                activeOpacity={0.7}
              >
                <IconSymbol name="checkmark.circle.fill" size={18} color={t.semanticSuccess} />
                <Text style={[styles.sheetButtonText, { color: t.textPrimary }]}>
                  Trigger Surgery Complete
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.sheetButton, { backgroundColor: t.background }]}
                onPress={() => {
                  setShowDevSheet(false);
                  setTimeout(handleResetOnboarding, 300);
                }}
                activeOpacity={0.7}
              >
                <IconSymbol name="sparkles" size={18} color={t.accent} />
                <Text style={[styles.sheetButtonText, { color: t.textPrimary }]}>
                  Reset Onboarding
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.sheetCancel}
                onPress={() => setShowDevSheet(false)}
                activeOpacity={0.7}
              >
                <Text style={[styles.sheetCancelText, { color: t.accent }]}>
                  Close
                </Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </SafeAreaView>
  );
}

function daysUntil(dateStr: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  const diff = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return 'Scheduled for today';
  if (diff === 1) return 'Tomorrow';
  if (diff < 0) return '';
  return `${diff} days from now`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },

  // Header — matches Apple Health large-title pattern
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  headerText: {
    flex: 1,
  },
  dateLabel: {
    fontSize: 13,
    fontWeight: '400',
    marginBottom: 2,
  },
  greetingNormal: {
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: 0.37,
  },
  greeting: {
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: 0.37,
    fontStyle: 'italic',
  },

  // Dev pill
  devPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    marginTop: 20,
  },
  devPillText: {
    fontSize: 12,
    fontWeight: '500',
  },

  // Cards — iOS grouped-style
  card: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  cardLabel: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  accentBorder: {
    borderLeftWidth: 3,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
  },
  cardValue: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 0.35,
  },
  cardSubtext: {
    fontSize: 15,
    fontWeight: '400',
    marginTop: 4,
  },
  placeholderBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 'auto',
  },
  placeholderBadgeText: {
    fontSize: 11,
    fontWeight: '500',
  },

  // Study timeline
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timelineItem: {
    flex: 1,
  },
  timelineLabel: {
    fontSize: 13,
    fontWeight: '400',
    marginBottom: 2,
  },
  timelineValue: {
    fontSize: 17,
    fontWeight: '600',
  },
  timelineDivider: {
    width: StyleSheet.hairlineWidth,
    height: 32,
    marginHorizontal: 16,
  },

  // Watch reminder
  reminderCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  reminderContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  reminderTextContainer: {
    flex: 1,
  },
  reminderTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  reminderBody: {
    fontSize: 13,
    lineHeight: 18,
  },

  // All set
  allSetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  allSetText: {
    fontSize: 15,
    fontWeight: '400',
  },

  // Study section
  sectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 6,
  },
  studyBody: {
    fontSize: 15,
    lineHeight: 22,
  },

  // Dev tools sheet
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  sheetContent: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    padding: 20,
    paddingBottom: 40,
  },
  sheetHandle: {
    width: 36,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#C7C7CC',
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
    marginBottom: 16,
    textAlign: 'center',
  },
  sheetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 10,
    marginBottom: 8,
  },
  sheetButtonText: {
    fontSize: 17,
    fontWeight: '400',
  },
  sheetCancel: {
    alignItems: 'center',
    padding: 14,
    marginTop: 4,
  },
  sheetCancelText: {
    fontSize: 17,
    fontWeight: '600',
  },
});
