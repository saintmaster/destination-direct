exports.handler = async (event) => {
  if(event.httpMethod==='OPTIONS'){
    return{statusCode:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'}};
  }
  if(event.httpMethod!=='POST'){
    return{statusCode:405,headers:{'Access-Control-Allow-Origin':'*'},body:'Method not allowed'};
  }
  try{
    const BIN_ID='6a36e1c2f5f4af5e291572ad';
    const API_KEY='$2a$10$YgOyCAgFbhBf0bbROw70ROAwaasv6c9r/dyRyjmDP619RNBvSyNNC';
    const body=JSON.parse(event.body||'{}');
    const res=await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}`,{
      method:'PUT',
      headers:{'Content-Type':'application/json','X-Master-Key':API_KEY},
      body:JSON.stringify({msg:body.msg||'',route:body.route||'',t:Date.now()})
    });
    if(!res.ok)throw new Error('JSONBin PUT failed: '+res.status);
    return{statusCode:200,headers:{'Access-Control-Allow-Origin':'*'},body:'OK'};
  }catch(e){
    return{statusCode:500,headers:{'Access-Control-Allow-Origin':'*'},body:e.message};
  }
};
