'use strict'; // eslint-disable-line

const async = require('async');
const urijs = require('urijs');
const Scope = require('./Scope');
const HeadlessError = require('node-phantom-simple/headless_error');
const TimeoutError = require('callback-timeout/errors').TimeoutError;

const worker = require('./worker');
const timedRun = require('./timedRun');
const InvalidUrlError = require('./errors').InvalidUrlError;
const l = require('./logger');

/**
 * The protocol a URL without a protocol is written to.
 *
 * @private
 * @type {String}
 */
const defaultAbsoluteTo = 'http://';

module.exports = (crawlerInstance, writeResult, runnerKey, finderKey) => {
  const suffix = crawlerInstance.name ? `:${crawlerInstance.name}` : '';
  const prefix = `crawlkit${suffix}`;
  const logger = l(prefix);
  logger.info(`
        Starting to crawl.
        Concurrent PhantomJS browsers: ${crawlerInstance.concurrency}.
    `);
  const seen = new Set();

  return timedRun(logger, (done) => {
    if (!crawlerInstance.url) {
      throw new InvalidUrlError(crawlerInstance.url);
    }

    let q = null;
    const addUrl = (u) => {
      let url = urijs(u);
      url = url.absoluteTo(defaultAbsoluteTo);
      url.normalize();
      url = url.toString();

      if (!seen.has(url)) {
        logger.info(`Adding ${url}`);
        seen.add(url);
        q.push(new Scope(url));
        logger.info(`${q.length()} task(s) in the queue.`);
      } else {
        logger.debug(`Skipping ${url} - already seen.`);
      }
    };

    const processResult = (scope, err) => {
      if (err instanceof HeadlessError || err instanceof TimeoutError) {
        if (scope.tries < crawlerInstance.tries) {
          logger.info(`Retrying ${scope.url} - adding back to queue.`);
          q.unshift(scope.clone());
          return;
        }
        logger.info(`Tried to crawl ${scope.url} ${scope.tries} times. Giving up.`);
      }
      writeResult(scope);
    };

    q = async.queue(
      worker(crawlerInstance, runnerKey, finderKey, prefix, addUrl, processResult),
      crawlerInstance.concurrency
    );

    q.drain = () => {
      logger.debug(`Processed ${seen.size} discovered URLs.`);
      done();
    };

    try {
      addUrl(crawlerInstance.url);
    } catch (e) {
      throw new InvalidUrlError(crawlerInstance.url);
    }
  });
};
