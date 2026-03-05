import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import type { VitalsInsight } from '@/lib/services/health-summary';
import { useAppTheme } from '@/lib/theme/ThemeContext';

interface VitalsSectionProps {
  insight: VitalsInsight;
}

export function VitalsSection({ insight }: VitalsSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const { theme } = useAppTheme();
  const { colors: c } = theme;

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => setExpanded(!expanded)}
      style={[styles.card, { backgroundColor: c.card }]}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <IconSymbol name="heart.fill" size={17} color={c.semanticError} />
          <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>Vitals</Text>
        </View>
        <IconSymbol
          name="chevron.right"
          size={14}
          color={c.textTertiary}
          style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}
        />
      </View>

      <Text style={[styles.headline, { color: c.textPrimary }]}>
        {insight.headline}
      </Text>
      {insight.supportingText && (
        <Text style={[styles.supporting, { color: c.textSecondary }]}>
          {insight.supportingText}
        </Text>
      )}

      {expanded && insight.items.length > 0 && (
        <View style={styles.details}>
          {insight.items.map((item, index) => (
            <View key={item.label}>
              {index > 0 && <View style={[styles.divider, { backgroundColor: c.separator }]} />}
              <View style={styles.vitalRow}>
                <Text style={[styles.vitalLabel, { color: c.textTertiary }]}>
                  {item.label}
                </Text>
                <Text style={[styles.vitalValue, { color: c.textPrimary }]}>
                  {item.value}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  headline: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0.38,
    marginBottom: 4,
  },
  supporting: {
    fontSize: 15,
    lineHeight: 22,
  },
  details: {
    marginTop: 16,
  },
  vitalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  vitalLabel: {
    flex: 1,
    fontSize: 15,
  },
  vitalValue: {
    fontSize: 15,
    fontWeight: '600',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
});
