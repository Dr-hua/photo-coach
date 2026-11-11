function npmMirror(p) {
  var at = p.indexOf('@', 1);
  if (at < 0) return null;
  var name = p.slice(0, at), rest = p.slice(at + 1);
  var slash = rest.indexOf('/');
  if (slash < 0) return null;
  var ver = rest.slice(0, slash), path = rest.slice(slash + 1);
  return 'https://registry.npmmirror.com/' + name + '/' + ver + '/files/' + path;
}
var CDNS = [
  function (p) { return 'https://unpkg.com/' + p; },
  function (p) { return 'https://cdn.jsdelivr.net/npm/' + p; },
  npmMirror
];
var pkgs = [
  '@tensorflow/tfjs@4.22.0/dist/tf.min.js',
  '@tensorflow-models/pose-detection@2.1.3/dist/pose-detection.min.js',
  '@tensorflow-models/hand-pose-detection@2.0.1/dist/hand-pose-detection.min.js',
  '@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js'
];
pkgs.forEach(function (p) {
  console.log('■ ' + p);
  CDNS.forEach(function (f, i) {
    console.log('   [' + i + '] ' + f(p));
  });
});
