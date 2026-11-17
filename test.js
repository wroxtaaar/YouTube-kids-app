const assert=require('assert'),L=require('./lib');
const it=L.parseContent('# c\nkeyword: tom and jerry\nyoutube: https://youtu.be/dQw4w9WgXcQ\nhome: https://drive.google.com/file/d/abc_123/view | Party');
assert.equal(it.length,3);assert.equal(L.youtubeId(it[1].value),'dQw4w9WgXcQ');
const h=L.homeVideo(it[2].url,it[2].title);assert.equal(h.embed,'https://drive.google.com/file/d/abc_123/preview');assert.equal(h.title,'Party');
assert.equal(L.homeVideo('https://mega.nz/file/AbC#kEy').embed,'https://mega.nz/embed/AbC#kEy');
const html='<script>var ytInitialData = '+JSON.stringify({a:[{videoRenderer:{videoId:'x'.repeat(11),title:{runs:[{text:'T&J'}]},lengthText:{simpleText:'5:00'},ownerText:{runs:[{text:'Ch'}]}}}]})+';</script>';
assert.equal(L.parseSearchHtml(html,5)[0].title,'T&J');
console.log('ok');
