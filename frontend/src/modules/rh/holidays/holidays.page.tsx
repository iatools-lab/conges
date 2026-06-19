import { Feries } from "@/modules/admin/holidays/holidays.page";

export function RhFeries() {
  return (
    <Feries
      apiBasePath="/rh/holidays"
      title="Jours fériés"
      subtitle="Gestion RH du calendrier des jours fériés"
    />
  );
}
