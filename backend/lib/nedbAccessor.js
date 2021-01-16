'use strict';

const Datastore = require("nedb");

let instance;

class nedbAccessor {
  static getInstance(file) {
    if (!instance || instance.file !== file) {
      instance = new nedbAccessor(file);
    }
    return instance;
  }

  constructor(file) {
    this.file = file;
    this.db = new Datastore({ filename: file, autoload: true });
  }

  async search(condition = null, skip = 0, limit = 20) {
    const where = {};
    if (condition) where["$where"] = function() {
      return ["title", "officialTitle", "description"].reduce((ret, attr) => {
        return ret || checkLocaleAttr(this[attr], condition);
      }, false);
    }
    const task = this.db.find(where).sort({mapID: 1}).skip(skip).limit(limit + 1);

    return new Promise((res, rej) => {
      task.exec((err, docs) => {
        if (err) rej(err);
        else res(docs);
      });
    }).then((docs) => {
      let next = false;
      if (docs.length > limit) {
        docs.pop();
        next = true;
      }
      return {
        prev: skip > 0,
        next,
        docs
      }
    });
  }
};

function checkLocaleAttr(attr, condition) {
  const conds = condition.trim().split(" ");
  const isString = typeof attr === "string";
  return conds.reduce((ret, cond) => {
    const reg = new RegExp(cond);
    if (isString) return ret && (!!attr.match(reg));
    else return ret && (!!Object.keys(attr).reduce((ret_, lang) => ret_ || attr[lang].match(reg), false));
  }, true);
}

module.exports = nedbAccessor; // eslint-disable-line no-undef