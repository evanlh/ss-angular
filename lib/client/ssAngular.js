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


  // manages linking & unlinking paged models and presenting them as tho
  // they were a single array of pages
  function PagedModel(name, options, scope){
    var self = this;
    var pageModels = []; // store the individual linked models
    var aggregateArray = this[options.pagedArray] = []; // aggregate of all pageModels' pagedArray
    var cursor = 0;

    var pageTotal = 0;
    var pageCursor = {
      start: 0,
      end: options.activePages - 1,
      setPos: function(pos, lastActive){
        this.start = Math.max(0, pos);
        this.end = lastActive || this.start + options.activePages - 1;
        for (var j = this.start; j < this.end; j++){
          if (!pageModels[j]) {
            pageModels[j] = new Page(j);
          }
        }
        for (var j = 0; j < pageModels.length; j++){
          if (j < this.start || j > this.end){
            pageModels[j].unlink();
          }
          else {
            pageModels[j].link();
          }
        }
      },
      move: function(i){
        this.setPos(this.start + i);
        return true;
      },
      processTotal: function (total){
        var newPageCount = total / options.perPage;
        var lastPage = Math.ceil(newPageCount) - 1;

        console.log("last page:" + lastPage);
        // if our cursor extends beyond the results, move it back
        if (this.end > lastPage){
          var newCursorPos = Math.max(0, lastPage - (options.activePages - 1));
          this.setPos(newCursorPos, lastPage);
        }
        // wipe any pages that have no results w/ the new result count
        console.log("wiping from " + (lastPage + 1) + " to " + (pageModels.length - 1));
        for (var i = lastPage + 1; i < pageModels.length; i++){
          pageModels[i].wipe();
        }
      },
      lastPage: function(){ return pageModels[this.end]; },
      firstPage: function(){ return pageModels[this.start]; }
    };

    function Page(index){
      this.index = index;
      this.params = {};
      this.length = 0;
      this.linked = false;
      for (var p in options){
        this.params[p] = options[p];
      }
      this.params.offset = index*options.perPage;
      this.params.scopeName = (options.scopeName || name) + "__" + index;
    }

    Page.prototype = {
      link: function(){
        var page = this;
        if (this.linked || this.loading) return;
        this.model = {};
        this.loading = true;
        ss.linkModel(name, this.params, function(modelObj) {
          page.loading = false;
          page.linked = true;
          pageTotal = modelObj.count;
          pageCursor.processTotal(pageTotal);
          scope.$apply(function(scope) {
            // overwrite the model-level hash with the page-level hash every time
            self.hash = modelObj.hash;
            page.applyUpdate(modelObj);
          });
        });
      },
      unlink: function(){
        if (!this.linked) return;
        ss.unlinkModel(this.params.scopeName, this.params);
        this.linked = false;
      },
      applyUpdate: function(modelObj){
        // splice & concat the new page items, replacing the old
        var newItems = modelObj[options.pagedArray] || [];

        Array.prototype.splice.apply(aggregateArray, [this.params.offset, this.length ||0].concat(newItems));
        // update the page length & other properties
        this.length = newItems.length;
        this.model = modelObj;
        // if new length is 0 the results have been shortened so go to previous page
      },
      wipe: function(){
        Array.prototype.slice.apply(aggregateArray, [this.params.offset, this.length || 0]);
        this.model[options.pagedArray] = [];
      }
    };

    this.next = function(){
      pageCursor.move(1);
    };
    this.previous = function(){
      pageCursor.move(-1);
    };

    pageCursor.setPos(0);

    /*** OLD */
    function newPage(index){
      var myParams = {};
      for (var p in options){
        myParams[p] = options[p];
      }
      myParams.offset = index*options.perPage;
      myParams.scopeName = (options.scopeName || name) + "__" + index;
      pageModels[index] = { name: name, params: myParams, model: {}, linked: false, length: 0 };
      return pageModels[index];
    }

    function linkPage(index){
      if (typeof pageModels[index] == 'undefined') newPage(index);
      var page = pageModels[index];
      if (page.linked) return;

      ss.linkModel(name, page.params, function(modelObj) {
        scope.$apply(function(scope) {
          // overwrite the model-level hash with the page-level hash every time
          self.hash = modelObj.hash;
          // splice & concat the new page items, replacing the old
          var newItems = modelObj[options.pagedArray] || [];
          Array.prototype.splice.apply(aggregateArray, [page.params.offset, page.length ||0].concat(newItems));
          // update the page length & other properties
          page.length = newItems.length;
          page.model = modelObj;
          page.linked = true;
          // if new length is 0 the results have been shortened so go to previous page
          if (page.length == 0){
            self.previousPage();
          }
        });
      });
    };

    function unlinkPage(index){
      ss.unlinkModel(pageModels[index].name, pageModels[index].params);
      pageModels[index].linked = false;
    };

    // public
    this.nextPage = function(){
      // assume if the current linked page < perPage there are no more pages
      if (pageModels[cursor] && pageModels[cursor].length < options.perPage){
        return false;
      }
      cursor++;
      linkPage(cursor);
      // unlink the pages behind this page by activePages
      if (cursor >= options.activePages){
        var cursorTail = cursor - options.activePages;
        if (pageModels[cursorTail] && pageModels[cursorTail].linked){
          unlinkPage(cursor - options.activePages);
        }
      }
      return true;
    };

    this.previousPage = function(){
      if (cursor == 0){
        return false;
      }
      cursor--;
      linkPage(cursor);
      // unlink pages ahead of this page by activePages
      if (pageModels.length >= (cursor + options.activePages)){
        var cursorHead = cursor + options.activePages;
        if (pageModels[cursorHead] && pageModels[cursorHead].linked){
          unlinkPage(cursor + options.activePages);
        }
      }
      return true;
    };

    this.destroy = function(){
      for (var i = 0; i < pageModels.length; i++){
        if (pageModels[i].linked){
          unlinkPage(i);
        }
      }
      delete this[options.pagedArray];
    };

    // linkPage(cursor);
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
    scope._pagedModels[scopeName] && scope._pagedModels[scopeName].destroy();
    delete scope._pagedModels[scopeName];
    delete scope[scopeName];
  };


  this.$get = ['$rootScope', function($rootScope){
    return {};
  }];

  return {
  };
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
