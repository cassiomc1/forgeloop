import { openStorageDatabase } from "../../src/storage/connection.js";
const db=openStorageDatabase(process.argv[2]);
db.exec("BEGIN IMMEDIATE");
process.send({writerHeld:true});
setInterval(()=>{},1000);
