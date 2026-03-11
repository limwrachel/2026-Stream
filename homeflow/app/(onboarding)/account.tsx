/**
 * Account Screen (Onboarding)
 *
 * Sign in or create account step, positioned after consent and before permissions.
 * In dev mode, a skip button allows bypassing auth for faster iteration.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  useColorScheme,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useRouter, Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Colors, StanfordColors, Spacing } from '@/constants/theme';
import { OnboardingStep } from '@/lib/constants';
import { OnboardingService } from '@/lib/services/onboarding-service';
import { useAuth } from '@/hooks/use-auth';
import { saveSurgeryDate } from '@/src/services/throneFirestore';
import { getAuth } from '@/src/services/firestore';
import {
  OnboardingProgressBar,
  ContinueButton,
} from '@/components/onboarding';

export default function AccountScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { signInWithEmail, signUpWithEmail, signInWithApple, signInWithGoogle, isAuthenticated } = useAuth();

  const [mode, setMode] = useState<'login' | 'signup'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [loading, setLoading] = useState(false);

  // If user is already authenticated, advance automatically
  useEffect(() => {
    if (isAuthenticated) {
      handleAdvance();
    }
  }, [isAuthenticated]);

  const handleAdvance = async () => {
    // Flush any surgery date collected before login to Firestore now that we have a UID.
    const uid = getAuth().currentUser?.uid;
    if (uid) {
      const data = await OnboardingService.getData();
      const surgeryDate = data.eligibility?.surgeryDate;
      if (surgeryDate) {
        saveSurgeryDate(uid, surgeryDate).catch((err) => {
          console.warn('[Account] Failed to flush surgery date to Firestore:', err);
        });
      }
    }

    await OnboardingService.goToStep(OnboardingStep.PERMISSIONS);
    router.push('/(onboarding)/permissions' as Href);
  };

  const handleEmailAuth = async () => {
    if (mode === 'signup') {
      if (!email.trim() || !password.trim() || !firstName.trim() || !lastName.trim()) {
        Alert.alert('Missing Fields', 'Please fill in all fields.');
        return;
      }
    } else {
      if (!email.trim() || !password.trim()) {
        Alert.alert('Missing Fields', 'Please enter email and password.');
        return;
      }
    }

    setLoading(true);
    try {
      if (mode === 'signup') {
        await signUpWithEmail(email.trim(), password, {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
        });
      } else {
        await signInWithEmail(email.trim(), password);
      }
    } catch (error: any) {
      const message = error?.code === 'auth/invalid-credential'
        ? 'Invalid email or password.'
        : error?.code === 'auth/email-already-in-use'
        ? 'An account with this email already exists. Try signing in.'
        : error?.message || 'Authentication failed. Please try again.';
      Alert.alert('Error', message);
    } finally {
      setLoading(false);
    }
  };

  const handleAppleLogin = async () => {
    setLoading(true);
    try {
      await signInWithApple();
    } catch (error: any) {
      if (error?.code !== 'ERR_REQUEST_CANCELED') {
        Alert.alert('Apple Sign In Failed', error?.message || 'Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (error: any) {
      if (error?.code !== 'SIGN_IN_CANCELLED') {
        Alert.alert('Google Sign In Failed', error?.message || 'Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDevSkip = async () => {
    await OnboardingService.goToStep(OnboardingStep.PERMISSIONS);
    router.push('/(onboarding)/permissions' as Href);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <OnboardingProgressBar currentStep={OnboardingStep.ACCOUNT} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>
              {mode === 'signup' ? 'Create Account' : 'Sign In'}
            </Text>
            <Text style={[styles.subtitle, { color: colors.icon }]}>
              {mode === 'signup'
                ? 'Create an account to securely store your study data.'
                : 'Sign in to continue to StreamSync.'}
            </Text>
          </View>

          <View style={styles.form}>
            {mode === 'signup' && (
              <View style={styles.nameRow}>
                <TextInput
                  style={[styles.input, styles.nameInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                  placeholder="First Name"
                  placeholderTextColor={colors.icon}
                  value={firstName}
                  onChangeText={setFirstName}
                  autoCapitalize="words"
                  textContentType="givenName"
                  editable={!loading}
                />
                <TextInput
                  style={[styles.input, styles.nameInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                  placeholder="Last Name"
                  placeholderTextColor={colors.icon}
                  value={lastName}
                  onChangeText={setLastName}
                  autoCapitalize="words"
                  textContentType="familyName"
                  editable={!loading}
                />
              </View>
            )}

            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
              placeholder="Email"
              placeholderTextColor={colors.icon}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              textContentType="emailAddress"
              editable={!loading}
            />
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
              placeholder="Password"
              placeholderTextColor={colors.icon}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType={mode === 'signup' ? 'newPassword' : 'password'}
              editable={!loading}
            />

            <TouchableOpacity
              style={[styles.primaryButton, loading && styles.buttonDisabled]}
              onPress={handleEmailAuth}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {mode === 'signup' ? 'Create Account' : 'Sign In'}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.divider}>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            <Text style={[styles.dividerText, { color: colors.icon }]}>or</Text>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          </View>

          <View style={styles.socialButtons}>
            {Platform.OS === 'ios' && (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={
                  colorScheme === 'dark'
                    ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                    : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                }
                cornerRadius={12}
                style={styles.appleButton}
                onPress={handleAppleLogin}
              />
            )}

            <TouchableOpacity
              style={[styles.socialButton, { borderColor: colors.border }]}
              onPress={handleGoogleLogin}
              disabled={loading}
            >
              <Image
                source={require('@/assets/images/google-logo.png')}
                style={styles.googleLogo}
              />
              <Text style={[styles.socialButtonText, { color: colors.text }]}>
                Sign in with Google
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: colors.icon }]}>
              {mode === 'signup' ? 'Already have an account? ' : "Don't have an account? "}
            </Text>
            <TouchableOpacity onPress={() => setMode(mode === 'signup' ? 'login' : 'signup')}>
              <Text style={[styles.linkText, { color: StanfordColors.cardinal }]}>
                {mode === 'signup' ? 'Sign In' : 'Sign Up'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.screenHorizontal,
    justifyContent: 'center',
  },
  header: {
    marginBottom: Spacing.xl,
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 22,
  },
  form: {
    gap: Spacing.md,
  },
  nameRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  nameInput: {
    flex: 1,
  },
  input: {
    height: 52,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  primaryButton: {
    height: 52,
    backgroundColor: StanfordColors.cardinal,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: Spacing.lg,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    marginHorizontal: Spacing.md,
    fontSize: 14,
  },
  socialButtons: {
    gap: Spacing.sm,
  },
  appleButton: {
    height: 52,
  },
  socialButton: {
    height: 52,
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  googleLogo: {
    width: 20,
    height: 20,
  },
  socialButtonText: {
    fontSize: 17,
    fontWeight: '500',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: Spacing.xl,
  },
  footerText: {
    fontSize: 15,
  },
  linkText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
