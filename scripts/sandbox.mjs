import {spawn} from 'node:child_process';
const child=spawn(process.execPath,['services/api/src/server.js'],{stdio:'inherit',env:{...process.env,PORT:'8789',LOTUS_DATA_DIR:'.lotus-sandbox-data',LOTUS_SANDBOX:'1',LOTUS_LEDGER:'local'}});
process.on('SIGINT',()=>child.kill());process.on('SIGTERM',()=>child.kill());child.on('exit',code=>{process.exitCode=code||0;});
