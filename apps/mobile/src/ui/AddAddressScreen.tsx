/**
 * T15, screen one: paste an address, label it, start watching.
 *
 * Validation is local and immediate (ui/address.ts); the actual watching -- the
 * address-watched op and kicking off the backfill -- is the App's job via onSubmit,
 * so this screen stays a dumb form.
 */
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Address } from '@local-books/core';
import { validateAddress } from './address.js';

export interface AddAddressScreenProps {
  readonly alreadyWatched: readonly Address[];
  readonly onSubmit: (address: Address, label: string) => Promise<void>;
  readonly onCancel: () => void;
}

export function AddAddressScreen({
  alreadyWatched,
  onSubmit,
  onCancel,
}: AddAddressScreenProps): React.JSX.Element {
  const [addressText, setAddressText] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (): Promise<void> => {
    const validated = validateAddress(addressText);
    if (!validated.ok) {
      setError(validated.reason);
      return;
    }
    if (alreadyWatched.includes(validated.address)) {
      setError('You are already watching this address.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(validated.address, label.trim() || 'My address');
    } catch (cause) {
      setSubmitting(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.heading}>Watch an address</Text>
      <Text style={styles.hint}>
        Watch-only: the app reads this address&apos;s history from the chain. It never holds
        keys and can never move funds.
      </Text>

      <Text style={styles.fieldLabel}>Solana address</Text>
      <TextInput
        style={styles.input}
        value={addressText}
        onChangeText={(text) => {
          setAddressText(text);
          if (error !== null) setError(null);
        }}
        placeholder="Paste the address to watch"
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        testID="address-input"
      />

      <Text style={styles.fieldLabel}>Label</Text>
      <TextInput
        style={styles.input}
        value={label}
        onChangeText={setLabel}
        placeholder="e.g. Freelance income"
        testID="label-input"
      />

      {error !== null && (
        <Text style={styles.error} testID="address-error">
          {error}
        </Text>
      )}

      <View style={styles.buttons}>
        <Pressable style={[styles.button, styles.secondary]} onPress={onCancel} disabled={submitting}>
          <Text style={styles.secondaryText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.primary, submitting && styles.disabled]}
          onPress={() => void submit()}
          disabled={submitting}
          testID="watch-button"
        >
          {submitting ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.primaryText}>Start watching</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    paddingTop: 72,
    gap: 8,
  },
  heading: {
    fontSize: 24,
    fontWeight: '700',
  },
  hint: {
    fontSize: 13,
    opacity: 0.7,
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#c8c8d0',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    fontFamily: 'monospace',
  },
  error: {
    color: '#b3261e',
    fontSize: 13,
    marginTop: 8,
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  button: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primary: {
    backgroundColor: '#1f4e9c',
  },
  primaryText: {
    color: '#ffffff',
    fontWeight: '600',
  },
  secondary: {
    borderWidth: 1,
    borderColor: '#c8c8d0',
  },
  secondaryText: {
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.6,
  },
});
