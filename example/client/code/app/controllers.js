angular.module('exampleApp', ['ssAngular', 'ngRoute'])
  .config(['authProvider','$routeProvider','$locationProvider',function(authProvider,$routeProvider,$locationProvider) {
    authProvider.authServiceModule('example');
    authProvider.loginPath('/login');
    $routeProvider.
      when('/login', {controller:'AuthCtrl', templateUrl:'login.html'}).
      when('/app', {controller:'SSCtrl', templateUrl:'app.html'}).
      otherwise({redirectTo:'/app'});
    $locationProvider.html5Mode(true);
  }])
  .controller('SSCtrl',['$scope','$location','pubsub','rpc','model','pagedModel', 'auth', function($scope,$location,pubsub,rpc,model,pagedModel,auth) {
    $scope.messages = []
    $scope.streaming = false;
    $scope.status = "";

    $scope.linkModel('example', {name: 'Tom'},'modelData');
    $scope.linkPagedModel('pages', {perPage: 100, activePages: 3, pagedArray: 'pages'});

    $scope.$on('ss-example', function(event,msg) {
      $scope.messages.push(msg);
    });

    $scope.toggleData = function() {
      if(!$scope.streaming) {
        $scope.streaming = true;
        $scope.status = rpc('example.on');
      }
      else {
        $scope.streaming = false;
        $scope.messages = [];
        $scope.status = rpc('example.off', 'Too random');
      }
    };

    $scope.nextPage = function(){
      $scope.pages && $scope.pages.next();
    };
    $scope.prevPage = function(){
      $scope.pages && $scope.pages.previous();
    };

    $scope.$on('$destroy', function() {
      if($scope.streaming) {
        rpc('example.off', 'Navigated away');
      }
    });

    $scope.logout = function() {
      var promise = auth.logout();
      promise.then(function() {
        $location.path("/");
      });
    }
  }])
  .controller('AuthCtrl',['$scope', '$location', '$log', 'auth', function($scope, $location, $log, auth) {
    $scope.processAuth = function() {
      $scope.showError = false;
      var promise = auth.login($scope.user, $scope.password);
      promise.then(function(reason) {
        $log.log(reason);
        var newPath = '/app';
        if($scope.redirectPath) {
          newPath = $scope.redirectPath;
        }
        $location.path(newPath);
      }, function(reason) {
        $log.log(reason);
        $scope.showError = true;
        $scope.errorMsg = "Invalid login. The username and pass for the example app is user/pass";
      });
    };
  }]);
