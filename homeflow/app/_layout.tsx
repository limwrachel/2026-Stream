import React, { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
// Global CSS for web (theming for alert dialogs, etc.) - only processed on web
import '@/assets/styles/global.css';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/src/services/firebase';
import { bootstrapHealthKitSync } from '@/src/services/healthkitSync';

import { useOnboardingStatus } from '@/hooks/use-onboarding-status';
import { useAuth } from '@/hooks/use-auth';
import { useDataSyncCheck } from '@/hooks/use-data-sync-check';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { ErrorBoundary } from '@/components/error-boundary';
import { StandardProvider, useStandard } from '@/lib/services/standard-context';
import { AppThemeProvider, useAppTheme } from '@/lib/theme/ThemeContext';

export const unstable_settings = {
  // Initial route while loading
  initialRouteName: 'index',
};

// TEMP DEV BYPASS: skip auth requirement so tabs are accessible without signing in.
// Remove this (and the uses below) when auth is ready to test end-to-end.
const DEV_BYPASS_AUTH = __DEV__;

/**
 * Navigation stack with onboarding, auth, and main app routes
 */
function RootLayoutNav() {
  const onboardingComplete = useOnboardingStatus();
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();

  // Run bootstrapHealthKitSync exactly once per signed-in uid.
  // A ref guard prevents re-firing on re-renders or context refreshes.
  const lastBootstrappedUid = useRef<string | null>(null);

  useEffect(() => {
    const uid = user?.id;
    if (!uid) return;
    if (lastBootstrappedUid.current === uid) return;
    lastBootstrappedUid.current = uid;

    // Guaranteed debug write — confirms the app can reach Firestore.
    const pingPath = `debug/ping-${uid}`;
    setDoc(doc(db, pingPath), {
      ok: true,
      ts: serverTimestamp(),
      platform: Platform.OS,
    })
      .then(() => console.log(`[Firebase] Wrote debug ping: ${pingPath}`))
      .catch((err) => console.error("[Firebase] Debug ping write failed:", err));

    // Bootstrap HealthKit → Firestore sync (fire-and-forget; never throws).
    bootstrapHealthKitSync().catch((err) =>
      console.error("[HealthKit] bootstrapHealthKitSync error:", err),
    );
  }, [user?.id]);

  // Run 48-hour data sync check only when user is fully in the app
  useDataSyncCheck(!!onboardingComplete && isAuthenticated);

  // While checking onboarding/auth status, show loading
  if (onboardingComplete === null || authLoading) {
    return <LoadingScreen />;
  }

  const authed = isAuthenticated || DEV_BYPASS_AUTH;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* Onboarding flow - shown when not complete */}
      <Stack.Screen
        name="(onboarding)"
        options={{
          animation: 'fade',
        }}
        redirect={onboardingComplete}
      />

      {/* Auth flow - shown when onboarding complete but not signed in */}
      <Stack.Screen
        name="(auth)"
        options={{
          animation: 'fade',
        }}
        redirect={!onboardingComplete || isAuthenticated}
      />

      {/* Main app - shown when onboarding complete AND signed in (or dev bypass) */}
      <Stack.Screen
        name="(tabs)"
        redirect={!onboardingComplete || !authed}
      />

      {/* Modal screens */}
      <Stack.Screen
        name="questionnaire"
        options={{ presentation: 'modal' }}
      />
      <Stack.Screen
        name="modal"
        options={{ presentation: 'modal', title: 'Modal', headerShown: true }}
      />
      <Stack.Screen
        name="consent-viewer"
        options={{ presentation: 'modal', headerShown: false }}
      />
      <Stack.Screen
        name="throne-session"
        options={{ headerShown: false }}
      />

      {/* Post-surgery recovery instructions (Stanford HoLEP discharge) */}
      <Stack.Screen
        name="post-surgery-recovery"
        options={{ headerShown: false }}
      />

      {/* Dev-only: FHIR parser test screen (accessible from Profile > Developer) */}
      <Stack.Screen
        name="fhir-parser-test"
        options={{ headerShown: false }}
      />

      {/* Index route for initial redirect */}
      <Stack.Screen
        name="index"
        options={{ animation: 'none' }}
      />
    </Stack>
  );
}

function AppContent({ children }: { children: React.ReactNode }) {
  const { isLoading } = useStandard();

  if (isLoading) {
    return <LoadingScreen />;
  }

  return <>{children}</>;
}

/**
 * Inner shell — has access to AppThemeProvider so it can read the resolved theme
 * and pass it to React Navigation's ThemeProvider + StatusBar.
 */
function ThemedApp() {
  const { theme } = useAppTheme();

  return (
    <ThemeProvider value={theme.isDark ? DarkTheme : DefaultTheme}>
      <StandardProvider>
        <AppContent>
          <RootLayoutNav />
          <StatusBar style={theme.isDark ? 'light' : 'dark'} />
        </AppContent>
      </StandardProvider>
    </ThemeProvider>
  );
}

/**
 * Root Layout
 *
 * Handles onboarding, authentication, and main app navigation.
 * Flow: Onboarding -> Auth -> Main App
 */
export default function RootLayout() {
  return (
    <ErrorBoundary>
      <AppThemeProvider>
        <ThemedApp />
      </AppThemeProvider>
    </ErrorBoundary>
  );
}
