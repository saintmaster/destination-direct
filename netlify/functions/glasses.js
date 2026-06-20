exports.handler = async () => {
  try{
    const BIN_ID='6a36e1c2f5f4af5e291572ad';
    const API_KEY='$2a$10$YgOyCAgFbhBf0bbROw70ROAwaasv6c9r/dyRyjmDP619RNBvSyNNC';
    const res=await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`,{
      headers:{
        'X-Master-Key':API_KEY,
        'User-Agent':'Netlify-Function/1.0'
      }
    });
    if(!res.ok){
      const body=await res.text();
      throw new Error('JSONBin GET failed: '+res.status+' '+body.substring(0,100));
    }
    const data=await res.json();
    const d=data.record||{};
    const msg=d.msg||'No script yet — generate one in DD.';
    const route=d.route||'';
    const age=d.t?Math.round((Date.now()-d.t)/1000):null;
    const ageStr=age===null?'':(age<60?age+'s ago':Math.round(age/60)+'m ago');
    const safe=msg
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/\n/g,'<br>');
    const html=`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DD Script</title>
</head>
<body>
<article>
<h1>DD · ${route}${ageStr?' · '+ageStr:''}</h1>
<p>${safe}</p>
</article>
</body>
</html>`;
    return{statusCode:200,headers:{'Content-Type':'text/html','Cache-Control':'no-cache, no-store'},body:html};
  }catch(e){
    return{statusCode:500,headers:{'Content-Type':'text/html'},body:`<html><body><article><p>Error: ${e.message}</p></article></body></html>`};
  }
};
