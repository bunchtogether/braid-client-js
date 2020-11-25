// @flow

const log = (color:string, name:string, value:string | number, ...args:Array<any>) => {
  const label = `%c${name}: %c${value}`;
  if (args.length === 0) {
    console.log(label, 'color:#333; font-weight: bold', `color:${color}`);
    return;
  }
  console.group(label, 'color:#333; font-weight: bold', `color:${color}`);
  for (const arg of args) {
    if (typeof arg === 'undefined') {
      continue;
    } else if (typeof arg === 'string') {
      console.log(`%c${arg}`, 'color:#666');
    } else {
      if (arg && arg.err) {
        console.error(arg.err);
      } else if (arg && arg.error) {
        console.error(arg.error);
      }
      console.dir(arg);
    }
  }
  console.groupEnd();
};


module.exports.debug = (value:string | number, ...args:Array<any>) => {
  log('blue', 'Braid Client', value, ...args);
};

module.exports.info = (value:string | number, ...args:Array<any>) => {
  log('green', 'Braid Client', value, ...args);
};
module.exports.warn = (value:string | number, ...args:Array<any>) => {
  log('orange', 'Braid Client', value, ...args);
};
module.exports.error = (value:string | number, ...args:Array<any>) => {
  log('red', 'Braid Client', value, ...args);
};
module.exports.errorStack = (error:Error | MediaError) => {
  console.error(error);
};
