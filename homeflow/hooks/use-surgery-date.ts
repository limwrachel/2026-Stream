/**
 * Surgery Date Hook
 *
 * Reads the scheduled surgery date from onboarding medical history data.
 * Falls back to a placeholder date in dev builds when no real data exists.
 */

import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/lib/constants';

interface SurgeryDateInfo {
  /** The surgery date string (YYYY-MM-DD) or null */
  date: string | null;
  /** Human-readable label like "March 15, 2026" */
  dateLabel: string;
  /** Whether the surgery date has passed */
  hasPassed: boolean;
  /** Whether this is using placeholder data */
  isPlaceholder: boolean;
  /** Loading state */
  isLoading: boolean;
  /** Study start date (YYYY-MM-DD) — at least 1 week before surgery */
  studyStartDate: string | null;
  studyStartLabel: string;
  /** Study end date (YYYY-MM-DD) — 90 days after surgery */
  studyEndDate: string | null;
  studyEndLabel: string;
}

// Dev placeholder: surgery 2 weeks from now
function getPlaceholderDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().split('T')[0];
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function useSurgeryDate(): SurgeryDateInfo {
  const [info, setInfo] = useState<SurgeryDateInfo>({
    date: null,
    dateLabel: '',
    hasPassed: false,
    isPlaceholder: true,
    isLoading: true,
    studyStartDate: null,
    studyStartLabel: '',
    studyEndDate: null,
    studyEndLabel: '',
  });

  useEffect(() => {
    let cancelled = false;

    async function loadSurgeryDate() {
      try {
        // Check AsyncStorage directly for a surgery date field
        const stored = await AsyncStorage.getItem(STORAGE_KEYS.MEDICAL_HISTORY);
        let surgeryDate: string | null = null;

        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            surgeryDate = parsed.surgeryDate ?? null;
          } catch {
            // ignore parse errors
          }
        }

        if (cancelled) return;

        const isPlaceholder = !surgeryDate;
        const effectiveDate = surgeryDate ?? (__DEV__ ? getPlaceholderDate() : null);

        if (effectiveDate) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const surgDate = new Date(effectiveDate + 'T12:00:00');
          const hasPassed = surgDate <= today;

          // Study start: 7 days before surgery; Study end: 90 days after surgery
          const startDate = addDays(effectiveDate, -7);
          const endDate = addDays(effectiveDate, 90);

          setInfo({
            date: effectiveDate,
            dateLabel: formatDateLabel(effectiveDate),
            hasPassed,
            isPlaceholder,
            isLoading: false,
            studyStartDate: startDate,
            studyStartLabel: formatDateLabel(startDate),
            studyEndDate: endDate,
            studyEndLabel: formatDateLabel(endDate),
          });
        } else {
          setInfo({
            date: null,
            dateLabel: 'Not scheduled',
            hasPassed: false,
            isPlaceholder: true,
            isLoading: false,
            studyStartDate: null,
            studyStartLabel: 'Not scheduled',
            studyEndDate: null,
            studyEndLabel: 'Not scheduled',
          });
        }
      } catch {
        if (!cancelled) {
          setInfo({
            date: null,
            dateLabel: 'Not scheduled',
            hasPassed: false,
            isPlaceholder: true,
            isLoading: false,
            studyStartDate: null,
            studyStartLabel: 'Not scheduled',
            studyEndDate: null,
            studyEndLabel: 'Not scheduled',
          });
        }
      }
    }

    loadSurgeryDate();

    return () => {
      cancelled = true;
    };
  }, []);

  return info;
}
