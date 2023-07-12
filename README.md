### Problems

- Typescript generators cannot be typed
  - Like, Typescript has VERY basic support for it, useless for anything more advanced than a simple number counter.
- Generating stack traces with `new Error().stack` is VERY slow
  - We actually don't need the full call stack, just an index relative to the caller, this could be fixed with a custom typescript transform, but then the setup isn't as easy as an `npm install` for users.
- Object hashing is very slow, I wish we had something like `System.identityHashCode` from java.
  - Can be solved with specific hashers for each descriptor type, but then it would still be slow everywhere else.
- APIs built around JS generators cause too many issues due to function coloring
  - Its also very tedious to write, most bugs wre caused by missing `yield`s somewhere. Not looking forward to stuff like this again.
