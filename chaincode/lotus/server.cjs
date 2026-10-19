const Bootstrap = require('fabric-shim/lib/contract-spi/bootstrap');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
async function main() {
  console.log('Loading LOTUS chaincode contracts.');
  const info = Bootstrap.getInfoFromContract(__dirname);
  const metadata = await Bootstrap.getMetadata(__dirname);
  const ccid =
    process.env.CHAINCODE_ID ||
    fs.readFileSync(path.join(root, '.fabric-network/package-id'), 'utf8').trim();
  await Bootstrap.register(
    info.contracts,
    info.serializers,
    metadata,
    info.title,
    info.version,
    { ccid, address: '127.0.0.1:9999' },
    true
  );
  console.log('LOTUS chaincode service listening on 127.0.0.1:9999.');
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
