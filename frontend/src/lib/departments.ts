// Référentiel partagé des départements et des employés (mock data)
// Tout employé appartient OBLIGATOIREMENT à un département.

export type Department = {
  code: string;
  name: string;
  manager: string;
};

export const DEPARTMENTS: Department[] = [
  { code: "COM", name: "Commercial", manager: "Eric NJOYA" },
  { code: "TEC", name: "Technique", manager: "Serge KAMGA" },
  { code: "FIN", name: "Finance", manager: "Marthe TAMO" },
  { code: "SUP", name: "Support", manager: "Aline NDONGO" },
  { code: "RH", name: "Ressources Humaines", manager: "Christelle MBA" },
];

export type Employee = {
  matricule: string;
  name: string;
  department: string; // code
  role: "employee" | "manager" | "rh" | "admin";
};

export const EMPLOYEES: Employee[] = [
  { matricule: "E-1042", name: "Marie NGUE", department: "COM", role: "employee" },
  { matricule: "E-1043", name: "Paul TCHUENTE", department: "COM", role: "employee" },
  { matricule: "E-1044", name: "Aline NDONGO", department: "SUP", role: "manager" },
  { matricule: "E-1045", name: "Serge KAMGA", department: "TEC", role: "manager" },
  { matricule: "E-1046", name: "Julie MBIAM", department: "FIN", role: "employee" },
  { matricule: "E-1047", name: "Eric TALLA", department: "TEC", role: "employee" },
  { matricule: "E-1048", name: "Sonia FOTSO", department: "COM", role: "employee" },
];

export const CURRENT_USER = EMPLOYEES[0]; // Marie NGUE, Commercial

export const LEAVE_TYPES = [
  { code: "CP", label: "Congés payés" },
  { code: "RTT", label: "RTT" },
  { code: "SPE", label: "Congé spécial" },
  { code: "SAN", label: "Sans solde" },
] as const;
