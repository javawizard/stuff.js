
// TODO: One big glaring problem: Reading from ephemeral objects during a
// render will cause those objects to be hung onto by the rendering component
// indefinitely. Possible solution: ignore all objects created after the render
// started. Need to think about that to make sure that doesn't miss observing
// anything we _should_ be observing... Probably at least need to re-render in
// case such an object was attached to a more permanent object, but we'd
// presumably do that anyway on account of said reattachment...
// Also see what happens if we try to modify something while rendering.

Stuff = {
  _currentReadSet = null,
  
  View: {
    wrap: function(props) {
      var realRender = props.render;
      var realComponentWillUnmount = props.componentWillUnmount;
      
      props.render = function() {
        Stuff._currentReadSet = new Set();
        
        try {
          realRender.call(this);
        } finally {
          var oldReadSet = this.stuffWeAreWatching || new Set();
          var newReadSet = Stuff._currentReadSet;
          Stuff._currentReadSet = null;
          
          // Attach listeners to things we read this time but not last time
          newReadSet.forEach(function(model) {
            if (!oldReadSet.has(model)) {
              model.stuffWatchingUs = model.stuffWatchingUs || new Set();
              model.stuffWatchingUs.add(this);
            }
          }.bind(this));
          
          // Detach listeners from things we read last time but not this time
          oldReadSet.forEach(function(model) {
            if (!newReadSet.has(model)) {
              model.stuffWatchingUs.delete(this);
            }
          });
          
          // Replace last run's read set with this one's
          this.stuffWeAreWatching = newReadSet;
        }
      };
      
      props.componentWillUnmount = function() {
        this.stuffWeAreWatching.forEach(function(model) {
          model.delete(this);
        }.bind(this));
        
        this.stuffWeAreWatching = null;
        
        if (realComponentWillUnmount) {
          realComponentWillUnmount.call(this);
        }
      };
      
      return props;
    },
    
    createClass: function(props) {
      return React.createClass(Stuff.View.wrap(props));
    }
  },
  
  Model: {
    wrap: function(props) {
      props.stuffWasRead = function() {
        if (Stuff._currentReadSet) {
          Stuff._currentReadSet.add(this);
        }
      };
      
      props.stuffWasWritten = function() {
        if (this.stuffWatchingUs) {
          this.stuffWatchingUs.forEach(function(view) {
            view.setState(view.state);
          }.bind(this));
        }
      };
      
      return props;
    }
  },
  
  Object: {
    // A lot of this stuff (and Stuff.Array) can be made much prettier once
    // Object#observe and Array#observe actually see some widespread support.
    // Maybe have some sort of experimental mode wherein those are used instead
    // on the all of one browser that supports them?
    createClass: function() {
      var properties = arguments;
      
      // Pop the last argument and use it as a prototype if it's an object
      if (typeof properties[properties.length - 1] == 'object') {
        var prototype = properties.pop();
      } else {
        var prototype = {};
      }
      
      // Pop the one before it and use it as a constructor if it's a function
      if (typeof properties[properties.length - 1] == 'function') {
        var realConstructor = properties.pop();
      } else {
        var realConstructor = null;
      }
      
      // Wrap the provided constructor with one that attaches the specified
      // properties to the object
      var constructor = function() {
        properties.forEach(function(prop) {
          Object.defineProperty(this, prop, {
            get: function() {
              return this.get(prop);
            },
            
            set: function(value) {
              return this.set(prop, value);
            }
          });
        }.bind(this));
        
        if (realConstructor) {
          realConstructor.apply(this, arguments);
        }
      }
      
      constructor.prototype = Stuff.Model.wrap(prototype);
      
      constructor.prototype.get = function(key) {
        this._data = this._data || {};
        this.stuffWasRead();
        return this._data[key];
      };
      
      constructor.prototype.set = function(key, value) {
        this._data = this._data || {};
        this.stuffWasWritten();
        this._data[key] = value;
      };
      
      return constructor;
    },
    
    create: function() {
      // TODO: Whole bunch of duplication between this and createClass
      var properties = arguments;
      
      if (typeof properties[properties.length - 1] == 'object') {
        var object = properties.pop();
      } else {
        var object = {};
      }
      
      Stuff.Model.wrap(object);
      
      properties.forEach(function(prop) {
        Object.defineProperty(object, prop, {
          get: function() {
            return this.get(prop);
          },
          
          set: function(value) {
            return this.set(prop, value);
          }
        });
      }.bind(this));
      
      object.get = function(key) {
        this._data = this._data || {};
        this.stuffWasRead();
        return this._data[key];
      }
      
      object.set = function(key, value) {
        this._data = this._data || {};
        this.stuffWasWritten();
        this._data[key] = value;
      }
      
      return object;
    }
  },
  
  Array: {
    create: {
      // TODO: Recreating everything like this is stupid. Also this should
      // probably be extracted into some sort of method that can be used to
      // give an arbitrary object array-like behavior... which brings up an
      // interesting question: what happens if someone tries to do something
      // like Stuff.Object.wrap(Stuff.Array.wrap(foo))? Should that be allowed?
      // I don't see why not...
      // Also methods like concat really ought to return new Stuff.Array.create
      // arrays so that they can also be observed.
      var object = {
        add: function() {
          
        }
      };
    }
  }
}
