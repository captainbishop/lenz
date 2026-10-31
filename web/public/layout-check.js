const results = document.querySelector('#results');
for (const [url, width, height] of [['./payment-demo.html', 375, 812], ['./payment-demo.html', 1024, 768], ['./brand/index.html', 375, 812], ['./brand/index.html', 1024, 768]]) {
  const frame = document.createElement('iframe');
  frame.title = `${url} at ${width} by ${height}`;
  frame.width = width; frame.height = height; frame.style.cssText = 'display:block;margin:24px 0;border:1px solid #cbd6c3';
  await new Promise(resolve => { frame.onload = resolve; frame.src = url; document.querySelector('#frames').append(frame); });
  await frame.contentDocument.fonts.ready;
  const documentWidth = frame.contentDocument.documentElement.scrollWidth;
  const images = [...frame.contentDocument.images];
  await Promise.all(images.map(image => image.decode()));
  const badImage = images.some(image => !image.naturalWidth);
  const pass = documentWidth <= width && !badImage;
  const row = document.createElement('p'); row.textContent = `${pass ? 'PASS' : 'FAIL'}: ${frame.title}; content width ${documentWidth}px; ${images.length} images loaded.`; results.append(row);
}
