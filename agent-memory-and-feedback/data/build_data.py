#!/usr/bin/env python3
"""Generate the two runtime data files in this directory from a single Python source of truth.

Outputs:
  - memory-pressure-test-inputs.json   — 10 records (M1-item0 .. M10-item0). Loaded into
                                         the `Disputes` Data Fabric entity (INSTALL.md Phase 2).
  - memory-items.json                  — 10 triples (past input + past output + expected
                                         output + analyst feedback). Carried by
                                         scripts/run_eval.py to attach the right feedback
                                         string to each agent run's trace.

The 14 input fields inside each `memory-pressure-test-inputs.json` row are the SAME as
the `pastInput` block of the matching `memory-items.json` entry — they're denormalized
because the two consumers want them in different shapes.

Design-time evals (B1-B10, M1-M10) are NOT generated here — they live as proper UiPath
evaluation sets in `../agent/evals/eval-sets/` and are run by Agent Builder directly.

Run:
    python3 build_data.py
"""

import json
from pathlib import Path

COMPANY = "PATH Industries"


# ---------------------------------------------------------------------------
# 10 memory items (M1-item0 .. M10-item0)
# Each tuple: (evalName, friendly_name, past_input, past_output, expected_output, feedback)
# - past_input: full 14-field agent input from the historical run
# - past_output: the email the agent actually produced (the imperfect one)
# - expected_output: the corrected email after the analyst's feedback would be applied
# - feedback: the analyst's correction prose (verbatim)
# ---------------------------------------------------------------------------
MEMORY = [
    ("M1-item0",
     "Tax type error: GST ITC reversal guidance",
     {  # past input
        "customer_name": "Madhav Saxena", "customer_tier": "gold", "flags": "none",
        "invoice_number": "INV-2026-02-1144",
        "dispute_description": "Invoice charged IGST 18% but the supply is intra-state — should be CGST 9% + SGST 9%.",
        "root_cause": "tax_type_error", "recommended_resolution": "revised_invoice",
        "line_items_summary": "Pharmaceutical raw materials HSN 2933",
        "adjustment_type": "revised_invoice", "adjustment_id": "REV-INV-2026-004928",
        "credit_amount": 0, "adjusted_invoice_balance": 1450000,
        "finance_manager_name": "Priya Nair", "company_name": COMPANY,
     },
     {  # past output (the imperfect email)
        "subject": "Revised Invoice Issued for INV-2026-02-1144",
        "body": "Dear Madhav,\n\nThank you for raising the GST treatment question on invoice INV-2026-02-1144.\n\nWe have reviewed the matter and confirm that the supply is intra-state. We have cancelled the original invoice and issued a revised invoice REV-INV-2026-004928 with the correct CGST 9% + SGST 9% split. The total amount remains unchanged.\n\nPlease update your records accordingly.\n\nRegards,\nPriya Nair\nAccounts Receivable, " + COMPANY,
     },
     {  # expected output (after feedback applied)
        "subject": "Revised Invoice Issued for INV-2026-02-1144 — GST Correction (IGST to CGST+SGST)",
        "body": "Dear Madhav,\n\nThank you for raising the GST treatment question on invoice INV-2026-02-1144. We have reviewed the matter and confirm that the supply is intra-state. The original invoice has been cancelled and revised invoice REV-INV-2026-004928 has been issued with the correct CGST 9% + SGST 9% split.\n\nTo reconcile this correction in your books, please ask your GST team to:\n\n1. Reverse the IGST input tax credit previously claimed against the cancelled invoice INV-2026-02-1144.\n2. Reclaim the equivalent CGST + SGST input tax credit against revised invoice REV-INV-2026-004928 in your next GSTR-3B return.\n\nThis treatment is in line with Rule 53 of the CGST Rules, which governs revised tax invoices.\n\nIf your GST team has any questions on the reconciliation, please reply to this email and we will assist.\n\nRegards,\nPriya Nair\nAccounts Receivable, " + COMPANY,
     },
     "The email is correct but operationally insufficient. The customer's GST team called back asking how to reconcile the cancelled IGST invoice in their books since they had already claimed IGST as ITC. Future emails for tax-type-error revised-invoice cases must explicitly tell the customer to (a) reverse the IGST ITC previously claimed and (b) reclaim the equivalent CGST+SGST in their next GSTR-3B return. Reference Rule 53 of the CGST Rules so the customer's GST team has a clear authority to cite. Without this, customers spend 1–2 days going back and forth with our AR team for clarification and risk filing incorrectly. This applies to every IGST→CGST+SGST correction regardless of customer.",
    ),
    ("M2-item0",
     "Duplicate charge: explicit reconciliation acknowledgment",
     {
        "customer_name": "Mohammed Khan", "customer_tier": "silver", "flags": "none",
        "invoice_number": "INV-2026-02-7320",
        "dispute_description": "I think we already paid this last month under a different invoice number — please verify.",
        "root_cause": "duplicate_charge", "recommended_resolution": "full_credit",
        "line_items_summary": "Full invoice, freight services SAC 9965",
        "adjustment_type": "credit_memo", "adjustment_id": "CM-2026-000841",
        "credit_amount": 184000, "adjusted_invoice_balance": 0,
        "finance_manager_name": "Rohan Iyer", "company_name": COMPANY,
     },
     {
        "subject": "Credit Memo Issued for INV-2026-02-7320",
        "body": "Dear Mohammed,\n\nThank you for flagging this. We have confirmed that invoice INV-2026-02-7320 was a duplicate of an earlier invoice already paid by your team. We have issued credit memo CM-2026-000841 for the full amount of ₹1,84,000, bringing the invoice balance to ₹0.\n\nWe apologize for the inconvenience.\n\nRegards,\nRohan Iyer\nAccounts Receivable, " + COMPANY,
     },
     {
        "subject": "Credit Memo Issued for INV-2026-02-7320 — Duplicate Charge Resolved",
        "body": "Dear Mohammed,\n\nOur internal reconciliation flagged invoice INV-2026-02-7320 as a duplicate of an earlier invoice already paid by your team — we apologize for the oversight. We have issued credit memo CM-2026-000841 for the full amount of ₹1,84,000, bringing the invoice balance to ₹0.\n\nFor your reassurance, other invoices on your account have been cross-checked against payment history and are correct — this appears to be an isolated incident.\n\nIf you have any questions, please reply to this email and we will assist.\n\nRegards,\nRohan Iyer\nAccounts Receivable, " + COMPANY,
     },
     "Customer replied asking, \"are there other duplicates I should check for?\" — they were spooked. For duplicate_charge cases, the email must explicitly state that the duplicate was caught by **internal reconciliation** (not by the customer's own follow-up), and proactively reassure that this is an isolated incident — the system performs cross-check against payment history on every invoice. Without that proactive line, ~30% of duplicate-charge customers spend hours auditing their other invoices unnecessarily and call AR for confirmation. Use phrasing like: \"Our internal reconciliation flagged this duplicate billing — we apologize for the oversight. Other invoices on your account have been cross-checked and are correct.\"",
    ),
    ("M3-item0",
     "Platinum tier + high-value: account manager mention",
     {
        "customer_name": "Aditi Rao", "customer_tier": "platinum", "flags": "high_value_account",
        "invoice_number": "INV-2026-02-3318",
        "dispute_description": "Pricing is above our LME-linked contracted rate.",
        "root_cause": "pricing_mismatch", "recommended_resolution": "partial_credit",
        "line_items_summary": "HR Coil HSN 7208, multiple lines",
        "adjustment_type": "credit_memo", "adjustment_id": "CM-2026-000914",
        "credit_amount": 640000, "adjusted_invoice_balance": 9460000,
        "finance_manager_name": "Priya Nair", "company_name": COMPANY,
     },
     {
        "subject": "Credit Memo for Pricing Correction — INV-2026-02-3318",
        "body": "Dear Aditi,\n\nThank you for surfacing this. We confirmed the pricing on the disputed lines was billed above your contracted LME-linked rate for the period. We have issued credit memo CM-2026-000914 for ₹6,40,000, adjusting the invoice balance to ₹94,60,000.\n\nWe appreciate your continued partnership.\n\nRegards,\nPriya Nair\nAccounts Receivable, " + COMPANY,
     },
     {
        "subject": "Credit Memo for Pricing Correction — INV-2026-02-3318",
        "body": "Dear Aditi,\n\nThank you for surfacing this. We confirmed the pricing on the disputed lines was billed above your contracted LME-linked rate for the period. We have issued credit memo CM-2026-000914 for ₹6,40,000, adjusting the invoice balance to ₹94,60,000.\n\nYour account manager has been informed of this resolution and may reach out separately.\n\nWe appreciate your continued partnership.\n\nRegards,\nPriya Nair\nAccounts Receivable, " + COMPANY,
     },
     "The account manager for this platinum-tier customer received an angry call asking why they hadn't been told about a >₹6L credit before the customer found out via email. Platinum-tier customers expect the relationship layer to be informed. For all platinum-tier credits ≥ ₹5L, the email must include a sentence such as: \"Your account manager has been informed of this resolution and may reach out separately.\" This is a tier-specific service expectation, not optional. (The agent does not have the account manager's name in its inputs — do not attempt to invent or echo a placeholder; use the no-name phrasing.)",
    ),
    ("M4-item0",
     "Revised invoice: \"no payment action required\" + books update",
     {
        "customer_name": "Pradeep Naidu", "customer_tier": "silver", "flags": "none",
        "invoice_number": "INV-2026-02-9981",
        "dispute_description": "IGST charged but supply is intra-state.",
        "root_cause": "tax_type_error", "recommended_resolution": "revised_invoice",
        "line_items_summary": "Industrial equipment components",
        "adjustment_type": "revised_invoice", "adjustment_id": "REV-INV-2026-005033",
        "credit_amount": 0, "adjusted_invoice_balance": 850000,
        "finance_manager_name": "Rohan Iyer", "company_name": COMPANY,
     },
     {
        "subject": "Revised Invoice for INV-2026-02-9981",
        "body": "Dear Pradeep,\n\nWe have reviewed the GST treatment on invoice INV-2026-02-9981 and confirmed the supply is intra-state. The original invoice has been cancelled and revised invoice REV-INV-2026-005033 has been issued with the correct CGST + SGST split.\n\nRegards,\nRohan Iyer\nAccounts Receivable, " + COMPANY,
     },
     {
        "subject": "Revised Invoice for INV-2026-02-9981 — CGST+SGST Correction",
        "body": "Dear Pradeep,\n\nWe have reviewed the GST treatment on invoice INV-2026-02-9981 and confirmed the supply is intra-state. The original invoice has been cancelled and revised invoice REV-INV-2026-005033 has been issued with the correct CGST + SGST split.\n\nNo payment action is required from your side — any prior payment remains applied to the revised invoice. Please update your records to replace cancelled invoice INV-2026-02-9981 with revised invoice REV-INV-2026-005033.\n\nIf you have any questions, please reply to this email.\n\nRegards,\nRohan Iyer\nAccounts Receivable, " + COMPANY,
     },
     "Customer's AP team replied asking whether they needed to make a new payment against the revised invoice (they had already paid the original) and whether they should treat the cancelled invoice as bad debt. Both questions are unnecessary if the email handles them. For all `adjustment_type: revised_invoice` cases, the email must include: (1) \"No payment action is required from your side — any prior payment remains applied to the revised invoice.\" (2) An explicit books-update instruction: \"Please update your records to replace cancelled invoice [X] with revised invoice [Y].\" Without these two lines, AP teams generate noise back to AR.",
    ),
    ("M5-item0",
     "Steel HSN family: cite contracted ₹/MT rate explicitly",
     {
        "customer_name": "Sunil Krishnan", "customer_tier": "gold", "flags": "none",
        "invoice_number": "INV-2026-02-2287",
        "dispute_description": "Pricing on the steel coil lines is over our contracted rate.",
        "root_cause": "pricing_mismatch", "recommended_resolution": "partial_credit",
        "line_items_summary": "HR Coil HSN 7208, 60 MT total",
        "adjustment_type": "credit_memo", "adjustment_id": "CM-2026-000976",
        "credit_amount": 150000, "adjusted_invoice_balance": 3850000,
        "finance_manager_name": "Priya Nair", "company_name": COMPANY,
     },
     {
        "subject": "Credit Memo Issued — INV-2026-02-2287",
        "body": "Dear Sunil,\n\nThank you for raising this. We confirmed that the pricing on the disputed lines was above your contracted rate. We have issued credit memo CM-2026-000976 for ₹1,50,000, adjusting the invoice balance accordingly.\n\nRegards,\nPriya Nair\nAccounts Receivable, " + COMPANY,
     },
     {
        "subject": "Credit Memo Issued — INV-2026-02-2287 (HR Coil Pricing Correction)",
        "body": "Dear Sunil,\n\nThank you for raising this. We reviewed the three HR Coil lines (HSN 7208, 60 MT total) on invoice INV-2026-02-2287 and confirmed the billed rate was above your contracted rate. Pricing has been corrected to the contracted rate of ₹65,000/MT per the pricing clause of your supply contract, and we have issued credit memo CM-2026-000976 for ₹1,50,000 — the ₹2,500/MT differential across the 60 MT supplied. The adjusted invoice balance is ₹38,50,000.\n\nIf you would like a line-by-line breakdown against your contract copy, please reply to this email and we will share the per-MT reconciliation.\n\nRegards,\nPriya Nair\nAccounts Receivable, " + COMPANY,
     },
     "The customer (a steel fabricator) replied requesting \"the specific ₹/MT contracted rate that was applied for verification against our contract.\" For steel and metal HSN families (7208, 7209, 7210, 7228, and adjacent), customers buy in MT and contract in ₹/MT — they cannot reconcile a credit memo without the ₹/MT cited explicitly. Future emails for these HSN families must state the contracted rate per MT and reference the contract / pricing clause: \"Pricing has been corrected to the contracted rate of ₹X/MT per the [pricing clause / Section Y of contract Z].\" This applies whenever line_items_summary mentions HR Coil, CR Coil, or any HSN starting with 72.",
    ),
    ("M6-item0",
     "Pricing correction: billing-system update commitment",
     {
        "customer_name": "Rakesh Gupta", "customer_tier": "silver", "flags": "none",
        "invoice_number": "INV-2026-02-4448",
        "dispute_description": "Pricing on line 2 doesn't match the rate card.",
        "root_cause": "pricing_mismatch", "recommended_resolution": "partial_credit",
        "line_items_summary": "Polymer granules",
        "adjustment_type": "credit_memo", "adjustment_id": "CM-2026-001022",
        "credit_amount": 38600, "adjusted_invoice_balance": 612400,
        "finance_manager_name": "Rohan Iyer", "company_name": COMPANY,
     },
     {
        "subject": "Credit Memo for Pricing Adjustment — INV-2026-02-4448",
        "body": "Dear Rakesh,\n\nThank you for bringing the pricing discrepancy on line 2 of invoice INV-2026-02-4448 to our attention. We reviewed the invoice against the applicable rate card and confirmed a pricing mismatch on the polymer granules line item. We have issued credit memo CM-2026-001022 for ₹38,600, adjusting your invoice balance to ₹6,12,400.\n\nIf you have any questions, please reply to this email.\n\nRegards,\nRohan Iyer\nAccounts Receivable, " + COMPANY,
     },
     {
        "subject": "Credit Memo for Pricing Adjustment — INV-2026-02-4448",
        "body": "Dear Rakesh,\n\nThank you for bringing the pricing discrepancy on line 2 of invoice INV-2026-02-4448 to our attention. We reviewed the invoice against the applicable rate card and confirmed a pricing mismatch on the polymer granules line item. We have issued credit memo CM-2026-001022 for ₹38,600, adjusting your invoice balance to ₹6,12,400.\n\nWe have updated the rate card in our billing system so subsequent invoices will reflect the contracted pricing.\n\nIf you have any questions, please reply to this email.\n\nRegards,\nRohan Iyer\nAccounts Receivable, " + COMPANY,
     },
     "The customer wrote back the next month asking whether the same pricing error would recur on their next invoice — implying our credit memo addressed the symptom but said nothing about whether the underlying cause was fixed in our billing system. Roughly 25% of pricing-mismatch customers raise the same dispute on their next month's invoice for this reason, generating preventable AR follow-up. For all `pricing_mismatch` credits, the email must include a sentence about the corrective action in our billing system. Phrasing: \"We have updated the rate card in our billing system so subsequent invoices will reflect the contracted pricing.\" This is not a promise about timelines; it's a confirmation that an upstream fix accompanies the credit. Apply to every pricing_mismatch credit regardless of customer.",
    ),
    ("M7-item0",
     "Repeat disputer: process-review call invitation",
     {
        "customer_name": "Bhavesh Patel", "customer_tier": "standard", "flags": "repeat_disputer",
        "invoice_number": "INV-2026-02-6671",
        "dispute_description": "Wrong tax rate again.",
        "root_cause": "tax_rate_error", "recommended_resolution": "partial_credit",
        "line_items_summary": "Industrial chemicals",
        "adjustment_type": "credit_memo", "adjustment_id": "CM-2026-001089",
        "credit_amount": 24000, "adjusted_invoice_balance": 376000,
        "finance_manager_name": "Priya Nair", "company_name": COMPANY,
     },
     {
        "subject": "Credit Memo for Tax Rate Correction — INV-2026-02-6671",
        "body": "Dear Bhavesh,\n\nThank you for bringing the tax rate concern on invoice INV-2026-02-6671 to our attention. We reviewed the matter and confirmed that an incorrect tax rate (18% instead of the applicable 12%) was applied to the industrial chemicals line items. We have issued credit memo CM-2026-001089 for ₹24,000, adjusting your invoice balance to ₹3,76,000.\n\nIf you have any questions, please reply to this email.\n\nRegards,\nPriya Nair\nAccounts Receivable, " + COMPANY,
     },
     {
        "subject": "Credit Memo for Tax Rate Correction — INV-2026-02-6671",
        "body": "Dear Bhavesh,\n\nThank you for bringing the tax rate concern on invoice INV-2026-02-6671 to our attention. We reviewed the matter and confirmed that an incorrect tax rate (18% instead of the applicable 12%) was applied to the industrial chemicals line items. We have issued credit memo CM-2026-001089 for ₹24,000, adjusting your invoice balance to ₹3,76,000.\n\nGiven the recurring nature of these adjustments on your account, we'd welcome a short process-review call with your team to identify any upstream changes that could prevent future discrepancies. Please reply to this email if you'd like to schedule one.\n\nRegards,\nPriya Nair\nAccounts Receivable, " + COMPANY,
     },
     "The customer is now on their 4th dispute this quarter (which is what the `repeat_disputer` flag tracks) and has been asking sales why the same kind of issue keeps surfacing. The AR team only learned about this after the AM escalated. By that point we'd already booked five process-review calls reactively across other repeat disputers — pattern that's now formalized. For all `repeat_disputer`-flagged accounts, the email must explicitly invite the customer to a brief process-review call. Phrasing: \"Given the recurring nature of these adjustments on your account, we'd welcome a short process-review call with your team to identify any upstream changes that could prevent future discrepancies. Please reply to this email if you'd like to schedule one.\" This signals pattern-awareness without being accusatory. Without this proactive offer, AR books these calls reactively after a 5th dispute, which is too late and damages the customer relationship. Apply whenever the `repeat_disputer` flag is present, regardless of tier or root cause.",
    ),
    ("M8-item0",
     "Missing discount: include calculation breakdown",
     {
        "customer_name": "Geeta Sundaram", "customer_tier": "gold", "flags": "none",
        "invoice_number": "INV-2026-02-8819",
        "dispute_description": "Could you confirm the credit memo for the missing volume discount.",
        "root_cause": "missing_discount", "recommended_resolution": "partial_credit",
        "line_items_summary": "Precision instruments",
        "adjustment_type": "credit_memo", "adjustment_id": "CM-2026-001144",
        "credit_amount": 64000, "adjusted_invoice_balance": 1136000,
        "finance_manager_name": "Rohan Iyer", "company_name": COMPANY,
     },
     {
        "subject": "Credit Memo Confirmation — INV-2026-02-8819",
        "body": "Dear Geeta,\n\nThank you for following up on the missing volume discount for invoice INV-2026-02-8819. We have issued credit memo CM-2026-001144 for ₹64,000 reflecting the missed discount, with your invoice balance now at ₹11,36,000.\n\nIf you have any questions, please reply to this email.\n\nRegards,\nRohan Iyer\nAccounts Receivable, " + COMPANY,
     },
     {
        "subject": "Credit Memo Confirmation — INV-2026-02-8819",
        "body": "Dear Geeta,\n\nThank you for following up on the missing volume discount for invoice INV-2026-02-8819. We have issued credit memo CM-2026-001144 for ₹64,000 reflecting the missed discount, with your invoice balance now at ₹11,36,000.\n\nCalculation: ₹16,00,000 (taxable value across affected lines) × 4% (volume discount) = ₹64,000.\n\nIf you have any questions, please reply to this email.\n\nRegards,\nRohan Iyer\nAccounts Receivable, " + COMPANY,
     },
     "Customer's AP team replied asking how the ₹64,000 figure was derived — they couldn't reconcile it against their PO without working backwards from the discount percentage. AP teams reconciling missed-discount credits need to see the math. For all `missing_discount` credits, the email must include the calculation breakdown showing how the credit was derived. Format: \"Calculation: [taxable value across affected lines] × [discount %] = ₹[credit].\" Concrete example for a 4% volume discount on ₹16,00,000 of qualifying purchases: \"Calculation: ₹16,00,000 × 4% = ₹64,000.\" Without this, AP teams reconciling against their own records often follow up asking for the breakdown. Apply to every missing_discount case regardless of customer.",
    ),
    ("M9-item0",
     "Tax rate error: GST ITC differential reversal",
     {
        "customer_name": "Anil Menon", "customer_tier": "silver", "flags": "none",
        "invoice_number": "INV-2026-02-5594",
        "dispute_description": "GST rate is 18% — for our HSN code it should be 5%.",
        "root_cause": "tax_rate_error", "recommended_resolution": "partial_credit",
        "line_items_summary": "Finished cotton fabric HSN 5208",
        "adjustment_type": "credit_memo", "adjustment_id": "CM-2026-001167",
        "credit_amount": 91000, "adjusted_invoice_balance": 482000,
        "finance_manager_name": "Priya Nair", "company_name": COMPANY,
     },
     {
        "subject": "Credit Memo for GST Rate Correction — INV-2026-02-5594",
        "body": "Dear Anil,\n\nThank you for raising the GST rate concern on invoice INV-2026-02-5594. We confirmed that 18% was applied where 5% is applicable for finished cotton fabric (HSN 5208). We have issued credit memo CM-2026-001167 for ₹91,000 covering the rate differential, adjusting the invoice balance to ₹4,82,000.\n\nIf you have any questions, please reply to this email.\n\nRegards,\nPriya Nair\nAccounts Receivable, " + COMPANY,
     },
     {
        "subject": "Credit Memo for GST Rate Correction — INV-2026-02-5594",
        "body": "Dear Anil,\n\nThank you for raising the GST rate concern on invoice INV-2026-02-5594. We confirmed that 18% was applied where 5% is applicable for finished cotton fabric (HSN 5208). We have issued credit memo CM-2026-001167 for ₹91,000 covering the rate differential, adjusting the invoice balance to ₹4,82,000.\n\nPlease ensure your GST team reverses the excess input tax credit (the differential between the originally-billed 18% rate and the corrected 5% rate) in your next GSTR-3B return; the credit memo above documents the corrected liability for your records.\n\nIf you have any questions, please reply to this email.\n\nRegards,\nPriya Nair\nAccounts Receivable, " + COMPANY,
     },
     "Eight months later this customer was flagged in a GST audit for an over-claimed input tax credit on this invoice — they had claimed 18% as ITC against the original invoice, but the corrected liability was only 5%. They had to pay back the differential plus interest. The credit memo email gave them no instruction to reverse the excess ITC, so it sat on their books. For all `tax_rate_error` credits where the customer was billed at a higher rate than applicable, the email must explicitly instruct the customer to reverse the **excess GST input tax credit** they may have claimed — specifically the differential between the originally-billed and corrected rates. Phrasing: \"Please ensure your GST team reverses the excess input tax credit (the differential between the originally-billed [X]% rate and the corrected [Y]% rate) in your next GSTR-3B return; the credit memo above documents the corrected liability for your records.\" This rule does NOT apply to `tax_type_error` cases — those have their own M1-item0 rule for full reverse-and-reclaim. Apply whenever root_cause is tax_rate_error.",
    ),
    ("M10-item0",
     "High-value (>10L) credit: formal close + escalation contact",
     {
        "customer_name": "Latha Aggarwal", "customer_tier": "gold", "flags": "high_value_account",
        "invoice_number": "INV-2026-02-1077",
        "dispute_description": "Pricing across all line items was billed at the prior contract's rates.",
        "root_cause": "pricing_mismatch", "recommended_resolution": "partial_credit",
        "line_items_summary": "Multiple line items, machined components",
        "adjustment_type": "credit_memo", "adjustment_id": "CM-2026-001218",
        "credit_amount": 1380000, "adjusted_invoice_balance": 7620000,
        "finance_manager_name": "Priya Nair", "company_name": COMPANY,
     },
     {
        "subject": "Credit Memo Issued — INV-2026-02-1077",
        "body": "Dear Latha,\n\nThank you for raising this. We confirmed that all line items were billed at pre-amendment MSA rates. We have issued credit memo CM-2026-001218 for ₹13,80,000, adjusting your invoice balance to ₹76,20,000.\n\nRegards,\nPriya Nair\nAccounts Receivable, " + COMPANY,
     },
     {
        "subject": "Credit Memo Issued — INV-2026-02-1077 (MSA Pricing Correction)",
        "body": "Dear Latha,\n\nWe acknowledge your dispute on invoice INV-2026-02-1077 and are writing to confirm the resolution. We verified that all line items were billed at pre-amendment MSA rates rather than the updated rates set out in the current MSA. We have issued credit memo CM-2026-001218 for ₹13,80,000, adjusting your invoice balance to ₹76,20,000.\n\nShould you have any questions, please reach me directly at priya.nair@path-industries.example.com.\n\nRegards,\nPriya Nair\nAR Manager\nAccounts Receivable, " + COMPANY,
     },
     "For credits exceeding ₹10,00,000, the customer's CFO replied directly asking who at " + COMPANY + " was accountable for the credit and how to escalate if any issue arose. The standard \"Regards, [Name], Accounts Receivable\" sign-off is too informal for credits of this size. For credit_amount ≥ ₹10,00,000, the sign-off must include the manager's role title (e.g., \"Priya Nair, AR Manager\" or \"Head of Accounts Receivable\") and an escalation contact line: \"Should you have any questions, please reach me directly at [phone or email].\" For these emails, also use a more measured opening — replace \"Thank you for raising this\" with a more formal acknowledgment such as \"We acknowledge your dispute on invoice [X] and are writing to confirm the resolution.\" This applies whenever the credit amount is ≥ ₹10,00,000 OR the `high_value_account` flag is present with a credit ≥ ₹5,00,000.",
    ),
]

assert len(MEMORY) == 10, f"expected 10 memory items, got {len(MEMORY)}"


# ---------------------------------------------------------------------------
# Emit the three JSON files.
# ---------------------------------------------------------------------------

here = Path(__file__).parent


def make_memory_pressure_test_record(eval_name: str, past_input: dict) -> dict:
    return {"evalName": eval_name, **past_input}


def make_memory_item(eval_name: str, name: str, past_input: dict, past_output: dict, expected_output: dict, feedback: str) -> dict:
    return {
        "evalName": eval_name,
        "name": name,
        "pastInput": past_input,
        "pastOutput": past_output,
        "expectedOutput": expected_output,
        "feedback": feedback,
    }


memory_pressure_test_records = [make_memory_pressure_test_record(name, past_input) for (name, _, past_input, _, _, _) in MEMORY]
memory_items_records = [make_memory_item(name, friendly, past_input, past_output, expected, feedback) for (name, friendly, past_input, past_output, expected, feedback) in MEMORY]


(here / "memory-pressure-test-inputs.json").write_text(json.dumps(memory_pressure_test_records, ensure_ascii=False, indent=2) + "\n")
(here / "memory-items.json").write_text(json.dumps(memory_items_records, ensure_ascii=False, indent=2) + "\n")

print(f"wrote {len(memory_pressure_test_records)} pressure-test records to memory-pressure-test-inputs.json")
print(f"wrote {len(memory_items_records)} memory items to memory-items.json")
print("memory item names:", [r["evalName"] for r in memory_items_records])
