function handler(event) {
  var request = event.request;
  var uri = request.uri;
  
  // Rewrite directory requests to index.html
  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  } else if (!uri.includes('.')) {
    // Path without extension and without trailing slash
    request.uri = uri + '/index.html';
  }
  
  return request;
}
