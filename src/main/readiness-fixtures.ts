import { createCanvas } from '@napi-rs/canvas';
export function imageFixture(text='Research evidence: the archive opened in 1847.'){
  const canvas=createCanvas(1400,220),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1400,220);ctx.fillStyle='black';ctx.font='40px Arial';ctx.fillText(text,35,100);return canvas;
}
export function pdfFixture(scanned=false,mixed=false,encrypted=false){
  const jpeg=imageFixture().toBuffer('image/jpeg');
  const text='BT /F1 18 Tf 35 100 Td (The archive opened in 1847 and held historical research evidence.) Tj ET';
  const objects:Array<Buffer|string>=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 700 160] /Resources ${scanned?'<< /XObject << /Im1 5 0 R >> >>':'<< /Font << /F1 5 0 R >> >>'} /Contents 4 0 R >>`,
    scanned?'<< /Length 32 >>\nstream\nq 700 0 0 110 0 20 cm /Im1 Do Q\nendstream':`<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    scanned?Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1400 /Height 220 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),jpeg,Buffer.from('\nendstream')]):'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  if(mixed){
    objects[1]='<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>';
    const drawing='q 700 0 0 110 0 20 cm /Im1 Do Q';
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 700 160] /Resources << /XObject << /Im1 8 0 R >> >> /Contents 7 0 R >>',`<< /Length ${drawing.length} >>\nstream\n${drawing}\nendstream`,Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1400 /Height 220 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),jpeg,Buffer.from('\nendstream')]));
  }
  if(encrypted)objects.push('<< /Filter /Standard /V 1 /R 2 /O <'+'01'.repeat(32)+'> /U <'+'02'.repeat(32)+'> /P -4 >>');
  const buffers=[Buffer.from('%PDF-1.4\n')],offsets=[0];let length=buffers[0].length;
  for(const [index,object] of objects.entries()){offsets.push(length);const bytes=Buffer.concat([Buffer.from(`${index+1} 0 obj\n`),Buffer.isBuffer(object)?object:Buffer.from(object),Buffer.from('\nendobj\n')]);buffers.push(bytes);length+=bytes.length;}
  buffers.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R ${encrypted?`/Encrypt ${objects.length} 0 R /ID [<${'03'.repeat(16)}><${'03'.repeat(16)}>]`:''} >>\nstartxref\n${length}\n%%EOF`));return Buffer.concat(buffers);
}
