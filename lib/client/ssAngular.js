'use strict';
var module = angular.module('ssAngular',[]);

module.factory('pubsub', ['$rootScope', function($rootScope) {
  //override the $on function
  var old$on = $rootScope.$on;
  Object.getPrototypeOf($rootScope).$on = function(name, listener) {
    var scope = this;
    if(name.length > 3 && name.substr(0,3) === 'ss-') {
      ss.event.on(name, function(message) {
        scope.$apply(function(s) {
          scope.$broadcast(name, message);
        });
      });
    }
    //make sure to call angular's version
    old$on.apply(this, arguments);
  };

  this.$get = ['$rootScope', function($rootScope){
    return {};
  }];
  return {};
}]);

module.factory('rpc', ['$q','$rootScope', function($q,$rootScope) {
  return function(command) {
    var args = Array.prototype.slice.apply(arguments);
    var deferred = $q.defer();
    ss.rpc.apply(ss, [command].concat(args.slice(1,args.length)).concat(function(response) {
      $rootScope.$apply(function(scope) {
        deferred.resolve(response);
      });
    }));
    return deferred.promise;
  };
}]);

module.factory('model', ['$rootScope', function($rootScope) {

  Object.getPrototypeOf($rootScope).unlinkModel = function(scopeName) {
    var scope = this;

    if(!scope[scopeName] || !scope._models[scopeName]) {
      return;
    }
    ss.unlinkModel(scope._models[scopeName].name, scope._models[scopeName].params);
    delete scope[scopeName];
    delete scope._models[scopeName];
  };

  Object.getPrototypeOf($rootScope).linkModel = function(name, params, scopeName) {
    var scope = this;
    if(typeof params === "string") {
      scopeName = params;
      params = null;
    }
    if(!scopeName) {
      scopeName = name;
    }

    if(scope[scopeName]) {
      return;
    }

    if(!scope._models) {
      scope._models = {};
    }

    scope._models[scopeName] = {name:name,params:params};
    scope[scopeName] = {};

    ss.linkModel(name, params, function(modelObj) {
      scope.$apply(function(scope) {
        scope[scopeName] = modelObj;
      });
    });
    scope.$on('$destroy', function(s) {
      if(scope[scopeName]) {
        scope.unlinkModel(scopeName);
      }
    });
  };

  this.$get = ['$rootScope', function($rootScope){
    return {};
  }];
  return {};
}]);

/* TODO There's a lot of this I don't like. It would be better if instead of handling multiple pages
   we just kept rebroadcasting a start-end window as a request parameter back to the server
*/
module.factory('pagedModel', ['$rootScope', '$interval', function($rootScope, $interval){

  // manages linking & unlinking paged models and presenting them as tho
  // they were a single array of pages
  function PagedModel(name, options, scope){
    var self = this;
    var pageModels = []; // store the individual linked models
    var aggregateArray = this[options.pagedArray] = []; // aggregate of all pageModels' pagedArray
    aggregateArray.pages = {};

    var lastUpdate = { id: 0, pageTotal: 0, lastPage: 0 };
    var pageCursor = {
      start: 0,
      end: options.activePages - 1,
      posBuffer: [],
      relinkHash: null,
      relink: function(){
        // console.log("total: " + lastUpdate.pageTotal + ", start: " + this.start + ", end: " + this.end);
        aggregateArray = [];
        var newHash = '';
        for (var j = 0; j < pageModels.length; j++){
          var page = pageModels[j];
          if (!page){
            page = pageModels[j] = new Page(j);
          }
          if (j < this.start || j > this.end){
            page.unlink();
            if (lastUpdate.id && j >= lastUpdate.lastPage){
              page.wipe();
            }
          }
          else {
            page.link();
          }
          aggregateArray = aggregateArray.concat(page.model[options.pagedArray] || []);
          newHash += (page.model.hash || '');
        }

        // remove dupes from the above concat
        if (!options.key) return;
        var keyedAggregate = {};
        var dupIndexes = [];
        for (var i = 0; i < aggregateArray.length; i++){
          var keyVal = aggregateArray[i][options.key];
          if (keyedAggregate[keyVal]){
            dupIndexes.push(i);
          }
          else {
            keyedAggregate[keyVal] = true;
          }
        }
        for (i = 0; i < dupIndexes.length; i++){
          aggregateArray.splice(dupIndexes[i] - i, 1);
        }

        self.hash = newHash; // model hash is concatenation of individual page hashes
        self[options.pagedArray] = aggregateArray;
        aggregateArray.lastUpdate = lastUpdate;
      },
      setPos: function(pos){
        // if we have results & our cursor extends beyond the results, move it back
        // TODO LINK/UNLINK thrashing on page boundaries?
        if (lastUpdate.id) {
          var end = pos + (options.activePages - 1);
          end = Math.max(Math.min(lastUpdate.lastPage, end), options.activePages - 1, 0);
          var start = Math.max(0, Math.min(end - (options.activePages -1), pos));
          this.start = start;
          this.end = end;
        }
        // otherwise push the position onto a buffer
        else {
          if (pos > 0 && this.posBuffer.length <= 5){
            this.posBuffer.push(pos);
          }
        }
        // allocate any missing Pages between start & end
        for (var j = this.start; j <= this.end; j++){
          if (!pageModels[j]) {
            pageModels[j] = new Page(j);
          }
        }
      },
      move: function(i){
        this.setPos(this.start + i);
      },
      processTotal: function (total){
        var newPageCount = total / options.perPage;
        lastUpdate.id++;
        lastUpdate.lastPage = Math.max(Math.ceil(newPageCount) - 1, 0);
        lastUpdate.pageTotal = total;
        if (this.start > lastUpdate.lastPage || this.end > lastUpdate.lastPage){
          this.setPos(lastUpdate.lastPage - (options.activePages -1));
        }
        // flush the position buffer
        while (this.posBuffer.length){
          this.setPos(this.posBuffer.shift());
        }
        lastUpdate.start = this.start;
        lastUpdate.end = this.end;
      }
    };
    pageCursor.relinkInterval = $interval(pageCursor.relink.bind(pageCursor), 1000);

    function Page(index){
      this.index = index;
      this.params = {};
      this.model = {};
      this.linked = false;
      for (var p in options){
        this.params[p] = options[p];
      }
      this.params.offset = index*options.perPage;
      this.params.scopeName = (options.scopeName || name) + "__" + index;
    };

    Page.prototype = {
      link: function(){
        var page = this;
        if (this.linked || this.loading) return;
        this.model = {};
        this.loading = true;
        ss.linkModel(name, this.params, function(modelObj) {
          page.loading = false;
          page.linked = true;
          pageCursor.processTotal(modelObj.count);
          page.applyUpdate(modelObj);
        });
      },
      unlink: function(){
        if (!this.linked) return;
        ss.unlinkModel(name, this.params);
        this.linked = false;
      },
      applyUpdate: function(modelObj){
        this.model = modelObj || {};
      },
      wipe: function(){
        this.model[options.pagedArray] = [];
      }
    };

    this.next = function(){
      pageCursor.move(1);
    };
    this.previous = function(){
      pageCursor.move(-1);
    };
    this.setPosition = function(i){
      pageCursor.setPos(i);
    };

    this.destroy = function(){
      for (var i = 0; i < pageModels.length; i++){
        pageModels[i].unlink();
      }
      delete this[options.pagedArray];
      pageCursor.relinkInterval && $interval.cancel(pageCursor.relinkInterval);
    };

    pageCursor.setPos(0);
  }

  /*
   * name: 'orders' // name of the model to link.
   * options: {
   *   scopeName: 'ordersModel', // name of the model on the scope object. defaults to name.
   *   perPage: 100, // number of records to return per page. default 100.
   *   activePages: 2, // number of pages to keep linked at any one time. default 1.
   *   pagedArray: 'orders', // name of the subarray document to page on. defaults to name.
   *   key: '_id' // key to uniquely identify documents within the pagedArrays array
                     (used for removing duplicates)
   * }
   *
   */
  Object.getPrototypeOf($rootScope).linkPagedModel = function(name, options){
    var scope = this;
    var defaults = {
      perPage: 100,
      activePages: 1,
      pagedArray: name,
      scopeName: name
    };

    if (!options){
      options = {};
    }
    for (var d in defaults){
      if (!options[d]){
        options[d] = defaults[d];
      }
    }
    if (scope[options.scopeName]){
      return;
    }

    if (!scope._pagedModels) {
      scope._pagedModels = {};
    };

    scope._pagedModels[options.scopeName] = new PagedModel(name, options, scope);
    scope[options.scopeName] = scope._pagedModels[options.scopeName];

    scope.$on('$destroy', function(s) {
      if(scope[options.scopeName]) {
        scope.unlinkPagedModel(options.scopeName);
      }
    });
  };

  Object.getPrototypeOf($rootScope).unlinkPagedModel = function(scopeName){
    var scope = this;
    if (!scope._pagedModels) {
      scope._pagedModels = {};
    };
    scope._pagedModels[scopeName] && scope._pagedModels[scopeName].destroy();
    delete scope._pagedModels[scopeName];
    delete scope[scopeName];
  };

  this.$get = ['$rootScope', function($rootScope){
    return {};
  }];

  return {};
}]);

module.provider('auth', function() {
  var loginPath = '/login';
  var authServiceModule = 'app';

  this.loginPath = function(path) {
    loginPath = path;
    return this;
  };
  this.authServiceModule = function(service) {
    authServiceModule = service;
    return this;
  };

  this.$get = ['$rootScope','$location', '$q', '$log', function($rootScope, $location, $q, $log) {
    var routeResponse = function() {
      if(!$rootScope.authenticated) { 
        var targetPath = $location.path();
        if(targetPath.indexOf(loginPath) < 0) {
          $log.log("User not logged in. Redirecting");
          $rootScope.redirectPath = targetPath;
          $location.path(loginPath);
        } //otherwise, we're already logging in
      }
    };
    $rootScope.$on('$locationChangeStart', function(current, previous) {
      routeResponse();
    });

    if(!$rootScope.authenticated) {
      ss.rpc(authServiceModule + ".authenticated", function(response) {
        $rootScope.$apply(function(scope) {
          $rootScope.authenticated = response;
          routeResponse();
        });
      });
    }

    return {
      login: function(user,password) {
        var deferred = $q.defer();
        ss.rpc(authServiceModule + ".authenticate", user, password, function(response) {
          $rootScope.$apply(function(scope) {
            if(response) {
              scope.authenticated = response;
              deferred.resolve("Logged in");
            }
            else {
              scope.authenticated = null;
              deferred.reject("Invalid");
            }
          });
        });
        return deferred.promise;
      },
      logout: function() {
        var deferred = $q.defer();
        ss.rpc(authServiceModule + ".logout", function() {
          $rootScope.$apply(function(scope) {
            scope.authenticated = null;
            deferred.resolve("Success");
          });
        });
        return deferred.promise;
      }
    };
  }];
});
