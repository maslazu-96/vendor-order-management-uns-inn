import zlib from 'node:zlib';

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = Array.from({length:256}, (_, n) => {
      let c=n;
      for(let k=0;k<8;k++) c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);
      return c>>>0;
    });
  }
  let crc=0xffffffff;
  for(const b of buf) crc=table[(crc^b)&0xff]^(crc>>>8);
  return (crc^0xffffffff)>>>0;
}
function u16(n){const b=Buffer.alloc(2);b.writeUInt16LE(n);return b}
function u32(n){const b=Buffer.alloc(4);b.writeUInt32LE(n>>>0);return b}
function zip(files){
  const locals=[]; const centrals=[]; let offset=0;
  for(const [name, content] of Object.entries(files)){
    const raw=Buffer.from(content); const comp=zlib.deflateRawSync(raw); const nb=Buffer.from(name); const crc=crc32(raw);
    const local=Buffer.concat([Buffer.from('504b0304','hex'),u16(20),u16(0),u16(8),u16(0),u16(0),u32(crc),u32(comp.length),u32(raw.length),u16(nb.length),u16(0),nb,comp]);
    locals.push(local);
    const central=Buffer.concat([Buffer.from('504b0102','hex'),u16(20),u16(20),u16(0),u16(8),u16(0),u16(0),u32(crc),u32(comp.length),u32(raw.length),u16(nb.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),nb]);
    centrals.push(central); offset += local.length;
  }
  const centralBuf=Buffer.concat(centrals);
  return Buffer.concat([...locals, centralBuf, Buffer.from('504b0506','hex'),u16(0),u16(0),u16(centrals.length),u16(centrals.length),u32(centralBuf.length),u32(offset),u16(0)]);
}
function esc(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')}
function colName(n){let s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)}return s}
export function makeXlsx(rows){
  const headers=['Order ID','Order Date','Supplier','PIC','Product','Qty','Unit','Price','Total','Status','Sent Date','Confirmation Date','Notes'];
  const all=[headers,...rows];
  const xmlRows=all.map((row,ri)=>`<row r="${ri+1}">${row.map((v,ci)=>{
    const ref=`${colName(ci+1)}${ri+1}`;
    if(typeof v==='number') return `<c r="${ref}"><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const files={
    '[Content_Types].xml':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    '_rels/.rels':`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml':`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Orders" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml':`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xmlRows}</sheetData></worksheet>`
  };
  return zip(files);
}
