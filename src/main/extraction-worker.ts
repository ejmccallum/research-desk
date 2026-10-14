import { parentPort, workerData } from 'node:worker_threads';
import { extractDocument } from './extraction.js';
try{await extractDocument(workerData,event=>parentPort?.postMessage(event));}
catch(error){parentPort?.postMessage({type:'failed',error:error instanceof Error?error.message:String(error)});}
