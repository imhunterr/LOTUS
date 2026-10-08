import { DEMO_ACCOUNTS, fetchLots, fetchShipments } from "../lib/chain";
import { PHARMACIES, useActors } from "../lib/useActors";
import { Card, ErrorNote, PageHeader, useAsync } from "../components/ui";
import ShipForm from "../components/ShipForm";
import ShipmentInbox from "../components/ShipmentInbox";

const ACC = DEMO_ACCOUNTS.distributor;

export default function Distributor() {
  const data = useAsync(async () => ({ lots: await fetchLots(), shipments: await fetchShipments() }));
  const actors = useActors();
  return (
    <>
      <PageHeader eyebrow="Step 2 · Distributor" title="Accept and forward stock">
        Custody is two-sided: the sender ships, the receiver must accept. Nobody can claim stock they were never sent,
        which is what makes the pharmacy's closure check trustworthy.
      </PageHeader>
      <ErrorNote error={data.error || actors.error} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Incoming shipments">
          {data.data && actors.data && (
            <ShipmentInbox {...data.data} me={actors.data.distributor} accountIndex={ACC} onChange={data.reload} />
          )}
        </Card>
        <Card title="Ship to a pharmacy">
          {data.data && actors.data && (
            <ShipForm lots={data.data.lots} accountIndex={ACC} onDone={data.reload}
              recipients={PHARMACIES.map((p) => ({ address: actors.data[p.key], label: p.label }))} />
          )}
        </Card>
      </div>
    </>
  );
}
