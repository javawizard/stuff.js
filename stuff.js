
// TODO: One big glaring problem: Reading from ephemeral objects during a
// render will cause those objects to be hung onto by the rendering component
// indefinitely. Possible solution: ignore all objects created after the render
// started. Need to think about that to make sure that doesn't miss observing
// anything we _should_ be observing... Probably at least need to re-render in
// case such an object was attached to a more permanent object, but we'd
// presumably do that anyway on account of said reattachment...
// Also see what happens if we try to modify something while rendering.
//
// TODO: Another flaw: What happens if we modify stuff we're watching during
// a render? Maybe not because we're trying to (we really shouldn't) but
// because we, say, remove something from an array, look at it, and put it
// back, or something like that... The fact that we really shouldn't be makes
// me think the correct answer is to just not re-render, but then we could miss
// out on watching newly-created objects that were attached to the model and
// therefore _should_ be watched...
// Possible solution: If we're told to re-render in the middle of a render, we
// wait until the end, then manually call render() in a loop until the read
// sets for two subsequent renders are identical, and maybe bail with an angry
// exception if that doesn't happen after a few loops. Then update read sets
// based on the result of the last render. There's _got_ to be a simpler
// answer...
// Or actually, maybe if we're asked to re-render in the middle of a render, we
// queue that up and then check up on it after we've finished rendering, and if
// this render produced the same read set as last render, just ignore the
// re-render request. Need to think about that. Also need to make sure that
// prevents two components from getting each other into mutual rendering loops,
// which I'm pretty sure it doesn't, unless we say that that logic applies when
// we're asked to re-render from _any_ render, not just a render of the current
// component. Then I think it might work.

Stuff = {
  _currentRendering: null,
  _lastRenderingId: 0,
  
  View: {
    wrap: function(props) {
      var realRender = props.render;
      var realComponentWillUnmount = props.componentWillUnmount;
      
      props.render = function() {
        Stuff._currentRendering = {
          id: ++Stuff._lastRenderingId,
          stuffThatWasRead: new Set()
        };
        
        try {
          realRender.call(this);
        } finally {
          var oldReadSet = this._stuffWeAreWatching || new Set();
          var newReadSet = Stuff._currentRendering.stuffThatWasRead;
          Stuff._currentRendering = null;
          
          // Attach listeners to things we read this time but not last time
          newReadSet.forEach(function(model) {
            if (!oldReadSet.has(model)) {
              model._stuffWatchingUs.add(this);
            }
          }.bind(this));
          
          // Detach listeners from things we read last time but not this time
          oldReadSet.forEach(function(model) {
            if (!newReadSet.has(model)) {
              model._stuffWatchingUs.delete(this);
            }
          });
          
          // Replace last run's read set with this one's
          this._stuffWeAreWatching = newReadSet;
        }
      };
      
      props.componentWillUnmount = function() {
        this._stuffWeAreWatching.forEach(function(model) {
          model._stuffWatchingUs.delete(this);
        }.bind(this));
        
        this._stuffWeAreWatching = null;
        
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
      props.weWereJustCreated = function() {
        if (Stuff._currentRendering) {
          this._stuffCreatedUsDuringRendering = Stuff._currentRendering.id;
        } else {
          this._stuffCreatedUsDuringRendering = null;
        }
        this._stuffWatchingUs = new Set();
      },
      
      props.stuffWasRead = function() {
        // Only add ourselves to stuffThatWasRead if we were not created during
        // the current rendering
        if (Stuff._currentRendering && Stuff._currentRendering.id != this._stuffCreatedUsDuringRendering) {
          Stuff._currentRendering.stuffThatWasRead.add(this);
        }
      },
      
      props.stuffWasWritten = function() {
        this._stuffWatchingUs.forEach(function(view) {
          view.setState(view.state);
        }.bind(this));
      },
      
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
        this.weWereJustCreated();
        this._data = {};
        
        // TODO: Heard somewhere that props couldn't be reliably defined on a
        // prototype. Pretty sure that's bogus now. Test that theory, then move
        // this to the prototype.
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
        this.stuffWasRead();
        return this._data[key];
      };
      
      constructor.prototype.set = function(key, value) {
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
      
      object.weWereJustCreated();
      object._data = {};
      
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
        this.stuffWasRead();
        return this._data[key];
      }
      
      object.set = function(key, value) {
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
      // I don't see why not... Update: Thinking wrap() will no longer work due
      // to the need to know when the object in question was created. This
      // whole point might be moot.
      // Also methods like concat really ought to return new Stuff.Array.create
      // arrays so that they can also be observed.
      var object = {
        get length() {
          this.stuffWasRead();
          return this._items.length;
        }
      };
      
      Stuff.Model.wrap(object);
      object.weWereJustCreated();
      object._items = [];
      
      ['concat', 'entries', 'every', 'filter', 'find', 'findIndex', 'forEach', 'includes',
       'indexOf', 'join', 'keys', 'lastIndexOf', 'map', 'reduce', 'reduceRight',
       'some', 'toLocaleString', 'toString', 'values'].forEach(function(name) {
        object[name] = function() {
          object.stuffWasRead();
          return object._items[name].call(object._items, arguments)
        }
      });
      
      ['copyWithin', 'fill', 'reverse', 'sort'].forEach(function(name) {
        object[name] = function() {
          object.stuffWasWritten();
          object._items[name].call(object._items, arguments);
        }
      });
      
      ['pop', 'push', 'shift', 'splice', 'unshift'].forEach(function(name) {
        object[name] = function() {
          object.stuffWasRead();
          object.stuffWasWritten();
          return object._items[name].call(object._items, arguments);
        }
      });
      
      object.at = function(index) {
        object.stuffWasRead();
        return object._items[index];
      }
      
      object.add = function(index, value) {
        object.stuffWasWritten();
        object._items[index] = value;
      }
      
      return object;
    }
  }
}
