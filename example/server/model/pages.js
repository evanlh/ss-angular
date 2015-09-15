//des describes the model and has the middleware
//chan is a channel on which to post the updated model object

var manyNumbers = [];
function randomRange(max){
  var arr = [];
  var len = Math.floor(Math.random()*max);
  for (var i = 0; i < len; i++){
    arr[i] = { key: i, random: Math.floor(Math.random()*100) };
  }
  return arr;
}

manyNumbers = randomRange(2000);
// randomize our array values every 2 seconds
setInterval(function(){
  manyNumbers.forEach(function(o){
    o.random = Math.floor(Math.random()*100);
  });
}, 2000);
// recreate random length array every 60 seconds
setInterval(function(){ manyNumbers = randomRange(2000); }, 60000);

exports.make = function(des,chan,ss) {
  des.use('session');
  des.use('client.auth');

  return {
    //must have a poll function for now. may have other update models
    poll: function(p) {
      // page results based on p.perPage and p.offset parameter
      var offset = p.offset || 0;
      var perPage = p.perPage || 100;
      var pagedArray = p.pagedArray || 'numbers';
      var d = new Date();
      var obj = {
        hash: Math.floor(d.getSeconds() / 2.0), //only update every 2 seconds even though polled every second
        count: manyNumbers.length
      };
      obj[pagedArray] = manyNumbers.slice(offset, offset + perPage);

      chan(obj);
    }
  };
};
