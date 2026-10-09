import { withStorageMaintenance, assertOwnedStorageMaintenance } from "../../src/storage/maintenance.js";

await withStorageMaintenance(process.argv[2], async () => {
  process.send({ ownerId: await assertOwnedStorageMaintenance(process.argv[2]) });
  await new Promise(() => setInterval(() => {}, 1000));
});
