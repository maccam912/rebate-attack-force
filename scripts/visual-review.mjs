// Optional local visual QA. No network service is required by npm test.
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
const base=process.env.OMLX_BASE_URL||'http://127.0.0.1:8000/v1';
const headers={'Content-Type':'application/json',Authorization:`Bearer ${process.env.OMLX_API_KEY||'0000'}`};
let models;
try{const r=await fetch(`${base}/models`,{headers,signal:AbortSignal.timeout(1500)});if(!r.ok)throw new Error(String(r.status));models=(await r.json()).data.map(m=>m.id);}catch{console.log('SKIP: optional local oMLX service is unavailable.');process.exit(0);}
const model=process.env.OMLX_VISION_MODEL||models.find(m=>/gemma-4-e2b/i.test(m))||models.find(m=>/gemma-4-12b/i.test(m));
if(!model){console.log('SKIP: no configured Gemma vision model is available. Set OMLX_VISION_MODEL.');process.exit(0);}
// Synthetic opaque blank PNG is a negative control, generated without external libraries.
function chunk(type,data){const name=Buffer.from(type),body=Buffer.concat([name,data]);let crc=0xffffffff;for(const byte of body){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const length=Buffer.alloc(4),tail=Buffer.alloc(4);length.writeUInt32BE(data.length);tail.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([length,body,tail]);}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(640);ihdr.writeUInt32BE(360,4);ihdr[8]=8;ihdr[9]=2;
const blank=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.alloc((640*3+1)*360))),chunk('IEND',Buffer.alloc(0))]);
const positive=await readFile(process.argv[2]||'test-results/03-grapple.png');
for(const [name,bytes,expected] of [['arena',positive,true],['blank-control',blank,false]]){
 const response=await fetch(`${base}/chat/completions`,{method:'POST',headers,signal:AbortSignal.timeout(90000),body:JSON.stringify({model,temperature:0,max_tokens:768,chat_template_kwargs:{enable_thinking:false},thinking_budget:0,response_format:{type:"json_object"},messages:[{role:'user',content:[{type:'text',text:'Inspect the image itself. Is a rendered, usable 2D frog platform game visible, with platforms, frog characters, and a coherent game interface? Blank or corrupted images must fail. Respond only with JSON: {"looksValid":boolean,"reason":"one short sentence"}.'},{type:'image_url',image_url:{url:`data:image/png;base64,${bytes.toString('base64')}`}}]}]})});
 if(!response.ok)throw new Error(`oMLX returned ${response.status}: ${(await response.text()).slice(0,300)}`);
 const body=await response.json();const answer=body.choices?.[0]?.message?.content||'';const match=answer.match(/\{[\s\S]*\}/);if(!match)throw new Error(`No JSON visual verdict: ${answer}`);const verdict=JSON.parse(match[0]);console.log(`${verdict.looksValid===expected?'PASS':'FAIL'}: ${name}: ${verdict.reason}`);if(verdict.looksValid!==expected)process.exitCode=1;
}
