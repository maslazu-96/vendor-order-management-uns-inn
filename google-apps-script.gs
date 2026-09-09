function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const rows = payload.rows || [];
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetName = 'Order Recap';
    let sh = ss.getSheetByName(sheetName);
    if (!sh) sh = ss.insertSheet(sheetName);

    const headers = [
      'Order ID','Order Date','Supplier','PIC','Product','Qty','Unit','Price','Total',
      'Status','Sent Date','Confirmation Date','Notes'
    ];
    const values = rows.map(r => [
      r.order_no || '', r.order_date || '', r.supplier || '', r.pic || '', r.product || '',
      Number(r.qty || 0), r.unit || '', Number(r.price || 0), Number(r.total || 0),
      r.status || '', r.sent_date || '', r.confirmation_date || '', r.notes || ''
    ]);

    sh.clearContents();
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    if (values.length) {
      sh.getRange(2, 1, values.length, headers.length).setValues(values);
      sh.getRange(2, 8, values.length, 2).setNumberFormat('#,##0');
    }
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, headers.length);

    return ContentService
      .createTextOutput(JSON.stringify({ok:true,count:values.length,sheet:sheetName}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ok:false,error:String(err)}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
