/**
 * Hand-rolled navigation for the five v0.1 screens (App.tsx holds the state), and
 * the one rule the Android hardware back button follows: a sub-screen goes back to
 * its parent, the ledger lets the system exit the app. Pure so it is unit-tested.
 */
export type Screen = 'ledger' | 'add' | 'invoices' | 'create-invoice' | 'income';

/** Where hardware back leads from `screen`; `null` means "let Android handle it". */
export function backTarget(screen: Screen): Screen | null {
  switch (screen) {
    case 'ledger':
      return null;
    case 'create-invoice':
      return 'invoices';
    case 'add':
    case 'invoices':
    case 'income':
      return 'ledger';
  }
}
