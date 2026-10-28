type Props = {
  providerMode: string;
  eligibleEditionRows: number;
  activeDisplay: boolean;
  expiresAt: string;
  navigate: (tab: string) => void;
};

export function SetupGuide({ providerMode, eligibleEditionRows, activeDisplay, expiresAt, navigate }: Props) {
  return <section className="panel setup-guide" aria-labelledby="setup-heading">
    <h2 id="setup-heading">Your path to a first display</h2>
    <p>{providerMode === "unconfigured"
      ? "Discovery is unavailable. You can still evaluate inventory imports, staff access, review, export and deletion. The operator must restore Qloo access before matching editions or generating recommendations."
      : providerMode === "fixture"
        ? "Rehearse with sample matches and simulated outcomes. This demonstrates the workflow, not customer demand or sales improvement."
        : "Qloo access is enabled. Confirm actual edition matches and stock before publishing. Affinity does not establish purchase likelihood."}</p>
    <ol>
      <li><strong>Review the shelves.</strong> {eligibleEditionRows} edition rows eligible at last refresh. Import a snapshot and review editions and quantities. <button className="inline-link" onClick={() => navigate("inventory")}>Start inventory review</button></li>
      <li><strong>Prepare and approve.</strong> Save a display, inspect its selections, approve the current version, then activate it. <button className="inline-link" onClick={() => navigate("display")}>Inspect display readiness</button></li>
      <li><strong>Check the reader handoff.</strong> {activeDisplay ? "An active display exists. Open its shopper link in a separate browser and check the counter handoff." : "No active display yet. Shopper discovery needs an approved, active display."}</li>
      <li><strong>Decide whether to continue.</strong> Review the evidence and record a decision. <button className="inline-link" onClick={() => navigate("review")}>Inspect review evidence</button></li>
    </ol>
    <p>This sample bookstore expires at {new Date(expiresAt).toLocaleString()}. Export records before expiry if needed. Real merchant sign-in, POS integration and sales benefit are not established.</p>
    <button className="button ghost" onClick={() => navigate("data")}>Export or delete this demo</button>
  </section>;
}
