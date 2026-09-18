/** Document kind labels, in the landlord's language rather than the trade's. */
export function humanKind(kind: string): string {
  switch (kind) {
    case "gas_safety_record": return "Gas safety record";
    case "eicr": return "Electrical safety report";
    case "eic": return "Electrical installation certificate";
    case "epc": return "Energy performance certificate";
    case "licence": return "Licence";
    case "deposit_certificate": return "Deposit certificate";
    case "tenancy_agreement": return "Tenancy agreement";
    case "prescribed_information": return "Prescribed information";
    case "right_to_rent_check": return "Right to rent check";
    default: return "Other document";
  }
}
