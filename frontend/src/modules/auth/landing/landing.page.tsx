import { AppShell } from "@/components/AppShell";
import { Card, CardHeader, Button } from "@/components/ui-kit";
import { Link } from "@tanstack/react-router";

const screens = [
  ["1. Connexion", "/login"],
  ["2. Tableau de bord Employé", "/"],
  ["3. Mon solde de congés", "/solde"],
  ["4. Demandes et planification", "/planifier"],
  ["5. Calendrier équipe", "/demandes"],
  ["6. Déclarer un événement", "/declarer"],
  ["7. Tableau de bord Manager", "/manager"],
  ["8. Validation d'une demande", "/manager/demandes"],
  ["9. Tableau de bord RH", "/rh"],
  ["10. Vue globale des congés", "/rh/global"],
  ["11. Gestion du passif", "/rh/passif"],
  ["12. Gestion des enfants", "/rh/enfants"],
  ["13. Congés spéciaux (RH)", "/rh/speciaux"],
  ["14. Employés (Admin)", "/admin/users"],
  ["15. Paramètres RH", "/admin/parametres"],
  ["16. Jours fériés", "/admin/feries"],
] as const;

export function Landing() {
  return (
    <AppShell title="Aperçu des écrans" subtitle="Conges upOwa · Gestion des Congés">
      <Card className="p-5">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {screens.map(([label, to]) => (
            <Link
              key={to}
              to={to}
              className="block border rounded-lg p-4 hover:border-navy hover:bg-accent transition-colors"
            >
              <div className="text-sm font-medium">{label}</div>
              <div className="text-xs text-muted-foreground mt-1">{to}</div>
            </Link>
          ))}
        </div>
      </Card>
    </AppShell>
  );
}
