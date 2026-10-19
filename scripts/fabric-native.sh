#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NET="$ROOT/.fabric-network"
CHANNEL="${LOTUS_FABRIC_CHANNEL:-lotus-operations}"
export PATH="$ROOT/.fabric-runtime/fabric/bin:$ROOT/.fabric-runtime/node/bin:$PATH"
export FABRIC_CFG_PATH="$NET/config" FABRIC_LOGGING_SPEC=warn
mkdir -p "$NET/config" "$NET/logs" "$NET/pids"
if [ ! -f "$NET/crypto/peerOrganizations/org1.example.com/msp/config.yaml" ]; then cryptogen generate --config="$ROOT/infra/fabric/cryptogen.yaml" --output="$NET/crypto";fi
node - "$ROOT" <<'NODE'
const fs=require('fs'),path=require('path'),root=process.argv[2];
fs.writeFileSync(path.join(root,'.fabric-network/config/configtx.yaml'),fs.readFileSync(path.join(root,'infra/fabric/configtx.yaml'),'utf8').replaceAll('__ROOT__',root));
fs.writeFileSync(path.join(root,'.fabric-network/config/core.yaml'),fs.readFileSync(path.join(root,'.fabric-runtime/fabric/config/core.yaml'),'utf8').replace('/opt/hyperledger/ccaas_builder',path.join(root,'.fabric-runtime/fabric/builders/ccaas')));
fs.copyFileSync(path.join(root,'.fabric-runtime/fabric/config/orderer.yaml'),path.join(root,'.fabric-network/config/orderer.yaml'));
NODE
if [ ! -f "$NET/$CHANNEL.block" ]; then configtxgen -profile LotusChannel -channelID "$CHANNEL" -outputBlock "$NET/$CHANNEL.block";fi
ORDERER="$NET/crypto/ordererOrganizations/example.com/orderers/orderer.example.com"
if [ ! -f "$NET/pids/orderer" ] || ! kill -0 "$(cat "$NET/pids/orderer")" 2>/dev/null;then
  env ORDERER_GENERAL_LISTENADDRESS=127.0.0.1 ORDERER_GENERAL_LISTENPORT=7050 ORDERER_GENERAL_LOCALMSPID=OrdererMSP ORDERER_GENERAL_LOCALMSPDIR="$ORDERER/msp" \
    ORDERER_GENERAL_TLS_ENABLED=true ORDERER_GENERAL_TLS_PRIVATEKEY="$ORDERER/tls/server.key" ORDERER_GENERAL_TLS_CERTIFICATE="$ORDERER/tls/server.crt" ORDERER_GENERAL_TLS_ROOTCAS="[$ORDERER/tls/ca.crt]" \
    ORDERER_GENERAL_KEEPALIVE_SERVERMININTERVAL=10s ORDERER_GENERAL_BOOTSTRAPMETHOD=none ORDERER_CHANNELPARTICIPATION_ENABLED=true ORDERER_ADMIN_LISTENADDRESS=127.0.0.1:7053 ORDERER_ADMIN_TLS_ENABLED=true \
    ORDERER_ADMIN_TLS_PRIVATEKEY="$ORDERER/tls/server.key" ORDERER_ADMIN_TLS_CERTIFICATE="$ORDERER/tls/server.crt" ORDERER_ADMIN_TLS_CLIENTROOTCAS="[$ORDERER/tls/ca.crt]" \
    ORDERER_FILELEDGER_LOCATION="$NET/orderer-data" ORDERER_CONSENSUS_WALDIR="$NET/orderer-wal" ORDERER_CONSENSUS_SNAPDIR="$NET/orderer-snapshots" ORDERER_OPERATIONS_LISTENADDRESS=127.0.0.1:7443 \
    nohup orderer > "$NET/logs/orderer.log" 2>&1 & echo $! > "$NET/pids/orderer"
fi
for n in 1 2;do
  port=7051;operations=7444;[ "$n" = 2 ] && port=9051 && operations=9444
  peerDir="$NET/crypto/peerOrganizations/org$n.example.com/peers/peer0.org$n.example.com"
  if [ ! -f "$NET/pids/peer$n" ] || ! kill -0 "$(cat "$NET/pids/peer$n")" 2>/dev/null;then
    env CORE_PEER_ID="peer0.org$n.example.com" CORE_PEER_ADDRESS="localhost:$port" CORE_PEER_LISTENADDRESS="127.0.0.1:$port" CORE_PEER_LOCALMSPID="Org${n}MSP" \
      CORE_PEER_MSPCONFIGPATH="$peerDir/msp" CORE_PEER_FILESYSTEMPATH="$NET/peer$n-data" CORE_LEDGER_SNAPSHOTS_ROOTDIR="$NET/peer$n-snapshots" \
      CORE_PEER_TLS_ENABLED=true CORE_PEER_TLS_CERT_FILE="$peerDir/tls/server.crt" CORE_PEER_TLS_KEY_FILE="$peerDir/tls/server.key" CORE_PEER_TLS_ROOTCERT_FILE="$peerDir/tls/ca.crt" \
      CORE_PEER_CHAINCODEADDRESS="127.0.0.1:$((port+1))" CORE_PEER_CHAINCODELISTENADDRESS="127.0.0.1:$((port+1))" CORE_PEER_GOSSIP_EXTERNALENDPOINT="localhost:$port" \
      CORE_PEER_KEEPALIVE_MININTERVAL=10s CORE_PEER_GOSSIP_USELEADERELECTION=false CORE_PEER_GOSSIP_ORGLEADER=true CORE_OPERATIONS_LISTENADDRESS="127.0.0.1:$operations" \
      nohup peer node start > "$NET/logs/peer$n.log" 2>&1 & echo $! > "$NET/pids/peer$n"
  fi
done
for attempt in $(seq 1 30);do if osnadmin channel list -o localhost:7053 --ca-file "$ORDERER/tls/ca.crt" --client-cert "$ORDERER/tls/server.crt" --client-key "$ORDERER/tls/server.key" > "$NET/logs/channel-list.log" 2>&1;then break;fi;sleep 1;done
if ! grep -q "$CHANNEL" "$NET/logs/channel-list.log";then osnadmin channel join --channelID "$CHANNEL" --config-block "$NET/$CHANNEL.block" -o localhost:7053 --ca-file "$ORDERER/tls/ca.crt" --client-cert "$ORDERER/tls/server.crt" --client-key "$ORDERER/tls/server.key";fi
setPeer(){ local n="$1";local port=7051;[ "$n" = 2 ] && port=9051;export CORE_PEER_ADDRESS="localhost:$port" CORE_PEER_LOCALMSPID="Org${n}MSP" CORE_PEER_TLS_ENABLED=true;export CORE_PEER_MSPCONFIGPATH="$NET/crypto/peerOrganizations/org$n.example.com/users/Admin@org$n.example.com/msp";export CORE_PEER_TLS_ROOTCERT_FILE="$NET/crypto/peerOrganizations/org$n.example.com/peers/peer0.org$n.example.com/tls/ca.crt"; }
for n in 1 2;do setPeer "$n";for attempt in $(seq 1 20);do if peer channel list > "$NET/logs/peer$n-channels.log" 2>&1;then break;fi;sleep 1;done;if ! grep -q "$CHANNEL" "$NET/logs/peer$n-channels.log";then peer channel join -b "$NET/$CHANNEL.block";fi;done
mkdir -p "$NET/package"
if [ ! -f "$NET/lotus.tgz" ];then
  printf '{"address":"localhost:9999","dial_timeout":"10s","tls_required":false}' > "$NET/package/connection.json"
  printf '{"type":"ccaas","label":"lotus_v2"}' > "$NET/package/metadata.json"
  tar -czf "$NET/package/code.tar.gz" -C "$NET/package" connection.json
  tar -czf "$NET/lotus.tgz" -C "$NET/package" metadata.json code.tar.gz
fi
setPeer 1
PACKAGE_ID="$(peer lifecycle chaincode calculatepackageid "$NET/lotus.tgz")"
printf '%s' "$PACKAGE_ID" > "$NET/package-id"
bash "$ROOT/scripts/fabric-chaincode-start.sh"
for attempt in $(seq 1 300);do if (echo > /dev/tcp/127.0.0.1/9999) >/dev/null 2>&1;then break;fi;sleep 1;done
(echo > /dev/tcp/127.0.0.1/9999) >/dev/null 2>&1 || { echo 'Chaincode did not become ready; inspect .fabric-network/logs/chaincode.log.' >&2;exit 1; }
for n in 1 2;do
  setPeer "$n"
  if ! peer lifecycle chaincode queryinstalled 2>/dev/null | grep -q "$PACKAGE_ID";then peer lifecycle chaincode install "$NET/lotus.tgz";fi
  if [ "$n" = 1 ];then sleep 6;fi
  if ! peer lifecycle chaincode querycommitted --channelID "$CHANNEL" --name lotus >/dev/null 2>&1; then
    peer lifecycle chaincode approveformyorg -o localhost:7050 --ordererTLSHostnameOverride orderer.example.com --channelID "$CHANNEL" --name lotus --version 2.0 --package-id "$PACKAGE_ID" --sequence 1 --tls --cafile "$ORDERER/tls/ca.crt" --signature-policy "AND('Org1MSP.peer','Org2MSP.peer')"
  fi
done
setPeer 1
if ! peer lifecycle chaincode querycommitted --channelID "$CHANNEL" --name lotus >/dev/null 2>&1;then peer lifecycle chaincode commit -o localhost:7050 --ordererTLSHostnameOverride orderer.example.com --channelID "$CHANNEL" --name lotus --version 2.0 --sequence 1 --tls --cafile "$ORDERER/tls/ca.crt" --signature-policy "AND('Org1MSP.peer','Org2MSP.peer')" --peerAddresses localhost:7051 --tlsRootCertFiles "$NET/crypto/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt" --peerAddresses localhost:9051 --tlsRootCertFiles "$NET/crypto/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt";fi
printf '\nFabric local network ready: %s, two endorsing organizations, one Raft orderer.\n' "$CHANNEL"
