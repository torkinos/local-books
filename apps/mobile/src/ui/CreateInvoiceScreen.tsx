/**
 * T18, creation half: client, line items, token, due date -> invoice-created op.
 *
 * A dumb form: validation lives in ui/invoiceForm.ts (pure, tested), arithmetic in
 * core, and the op construction -- including minting the reference key -- in the
 * App's onSubmit. Quantities are whole numbers by design (see core/invoice).
 */
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Address, InvoiceLineItem, UnixSeconds, WatchedAddressView } from '@local-books/core';
import type { InvoiceToken } from '../tokens.js';
import { invoiceTokens } from '../tokens.js';
import { shortAddress } from './format.js';
import type { LineItemInput } from './invoiceForm.js';
import { validateInvoiceDraft, ymdAfterDays } from './invoiceForm.js';

export interface CreateInvoiceSubmission {
  readonly clientName: string;
  readonly lineItems: readonly InvoiceLineItem[];
  readonly token: InvoiceToken;
  readonly dueDate: UnixSeconds;
  readonly payTo: Address;
}

export interface CreateInvoiceScreenProps {
  readonly watched: readonly WatchedAddressView[];
  readonly now: UnixSeconds;
  readonly onSubmit: (submission: CreateInvoiceSubmission) => Promise<void>;
  readonly onCancel: () => void;
}

/** Line inputs carry a stable key: index keys would re-associate rows on removal. */
type KeyedLine = LineItemInput & { readonly key: number };

export function CreateInvoiceScreen({
  watched,
  now,
  onSubmit,
  onCancel,
}: CreateInvoiceScreenProps): React.JSX.Element {
  const tokens = invoiceTokens();
  const nextKeyRef = useRef(1);
  const emptyLine = (): KeyedLine => ({
    key: nextKeyRef.current++,
    description: '',
    quantityText: '1',
    unitPriceText: '',
  });
  const [clientName, setClientName] = useState('');
  const [lines, setLines] = useState<readonly KeyedLine[]>(() => [emptyLine()]);
  const [tokenIndex, setTokenIndex] = useState(0);
  const [dueDateText, setDueDateText] = useState(ymdAfterDays(now, 14));
  const [payTo, setPayTo] = useState<Address | null>(watched[0]?.address ?? null);
  const [errors, setErrors] = useState<readonly string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  // Synchronous latch: setState is async, so `submitting` alone lets a double-tap
  // race through and mint TWO invoices -- each with its own fresh reference key,
  // so content addressing cannot collapse them, and no compensating op exists yet
  // to void one. Left set on success (the screen navigates away).
  const submittingRef = useRef(false);

  const token = tokens[tokenIndex] ?? tokens[0]!;

  const updateLine = (key: number, patch: Partial<LineItemInput>): void => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
    if (errors.length > 0) setErrors([]);
  };

  const submit = async (): Promise<void> => {
    if (submittingRef.current) return;
    const validated = validateInvoiceDraft({ clientName, lineItems: lines, token, dueDateText, payTo });
    if (!validated.ok) {
      setErrors(validated.errors);
      return;
    }
    submittingRef.current = true;
    setErrors([]);
    setSubmitting(true);
    try {
      await onSubmit({
        clientName: validated.clientName,
        lineItems: validated.lineItems,
        token,
        dueDate: validated.dueDate,
        payTo: validated.payTo,
      });
    } catch (cause) {
      submittingRef.current = false;
      setSubmitting(false);
      setErrors([cause instanceof Error ? cause.message : String(cause)]);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.heading}>New invoice</Text>

        <Text style={styles.fieldLabel}>Client</Text>
        <TextInput
          style={styles.input}
          value={clientName}
          onChangeText={(text) => {
            setClientName(text);
            if (errors.length > 0) setErrors([]);
          }}
          placeholder="Who is this for?"
          testID="client-input"
        />

        <Text style={styles.fieldLabel}>Line items</Text>
        {lines.map((line, index) => (
          <View key={line.key} style={styles.lineItem}>
            <TextInput
              style={styles.input}
              value={line.description}
              onChangeText={(text) => updateLine(line.key, { description: text })}
              placeholder="Description (e.g. Website redesign)"
              testID={`line-${index}-description`}
            />
            <View style={styles.lineNumbers}>
              <TextInput
                style={[styles.input, styles.qty]}
                value={line.quantityText}
                onChangeText={(text) => updateLine(line.key, { quantityText: text })}
                placeholder="Qty"
                keyboardType="number-pad"
                testID={`line-${index}-quantity`}
              />
              <TextInput
                style={[styles.input, styles.price]}
                value={line.unitPriceText}
                onChangeText={(text) => updateLine(line.key, { unitPriceText: text })}
                placeholder={`Unit price (${token.symbol})`}
                keyboardType="decimal-pad"
                testID={`line-${index}-price`}
              />
              {lines.length > 1 && (
                <Pressable
                  style={styles.removeLine}
                  onPress={() => setLines((current) => current.filter((l) => l.key !== line.key))}
                >
                  <Text style={styles.removeLineText}>✕</Text>
                </Pressable>
              )}
            </View>
          </View>
        ))}
        <Pressable style={styles.addLine} onPress={() => setLines((c) => [...c, emptyLine()])}>
          <Text style={styles.addLineText}>+ Add line item</Text>
        </Pressable>

        <Text style={styles.fieldLabel}>Token</Text>
        <View style={styles.chips}>
          {tokens.map((option, index) => (
            <Pressable
              key={option.label}
              style={[styles.chip, index === tokenIndex && styles.chipActive]}
              onPress={() => setTokenIndex(index)}
            >
              <Text style={index === tokenIndex ? styles.chipActiveText : styles.chipText}>
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.fieldLabel}>Due date</Text>
        <View style={styles.chips}>
          {[7, 14, 30].map((days) => (
            <Pressable
              key={days}
              style={[styles.chip, dueDateText === ymdAfterDays(now, days) && styles.chipActive]}
              onPress={() => setDueDateText(ymdAfterDays(now, days))}
            >
              <Text
                style={
                  dueDateText === ymdAfterDays(now, days) ? styles.chipActiveText : styles.chipText
                }
              >
                +{days}d
              </Text>
            </Pressable>
          ))}
          <TextInput
            style={[styles.input, styles.dateInput]}
            value={dueDateText}
            onChangeText={setDueDateText}
            placeholder="YYYY-MM-DD"
            autoCapitalize="none"
            testID="due-date-input"
          />
        </View>

        <Text style={styles.fieldLabel}>Pay to</Text>
        <View style={styles.chips}>
          {watched.map((view) => (
            <Pressable
              key={view.address}
              style={[styles.chip, payTo === view.address && styles.chipActive]}
              onPress={() => setPayTo(view.address)}
            >
              <Text style={payTo === view.address ? styles.chipActiveText : styles.chipText}>
                {view.label} ({shortAddress(view.address)})
              </Text>
            </Pressable>
          ))}
          {watched.length === 0 && (
            <Text style={styles.hint}>Watch an address first — invoices need somewhere to be paid.</Text>
          )}
        </View>

        {errors.map((error) => (
          <Text key={error} style={styles.error} testID="invoice-error">
            {error}
          </Text>
        ))}

        <View style={styles.buttons}>
          <Pressable style={[styles.button, styles.secondary]} onPress={onCancel} disabled={submitting}>
            <Text style={styles.secondaryText}>Cancel</Text>
          </Pressable>
          <Pressable
            style={[styles.button, styles.primary, submitting && styles.disabled]}
            onPress={() => void submit()}
            disabled={submitting}
            testID="create-invoice-button"
          >
            {submitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.primaryText}>Create invoice</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    padding: 24,
    paddingTop: 72,
    gap: 8,
  },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#c8c8d0',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    backgroundColor: '#ffffff',
  },
  lineItem: {
    gap: 8,
    marginBottom: 8,
  },
  lineNumbers: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  qty: {
    width: 72,
  },
  price: {
    flex: 1,
  },
  removeLine: {
    padding: 8,
  },
  removeLineText: {
    fontSize: 16,
    opacity: 0.5,
  },
  addLine: {
    paddingVertical: 6,
  },
  addLineText: {
    color: '#1f4e9c',
    fontWeight: '600',
    fontSize: 13,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  chip: {
    borderWidth: 1,
    borderColor: '#c8c8d0',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipActive: {
    backgroundColor: '#1f4e9c',
    borderColor: '#1f4e9c',
  },
  chipText: {
    fontSize: 13,
  },
  chipActiveText: {
    fontSize: 13,
    color: '#ffffff',
    fontWeight: '600',
  },
  dateInput: {
    flex: 1,
    minWidth: 130,
  },
  hint: {
    fontSize: 13,
    opacity: 0.7,
  },
  error: {
    color: '#b3261e',
    fontSize: 13,
    marginTop: 4,
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
