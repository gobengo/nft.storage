/* eslint-env serviceworker, browser */
/* global Response caches */

import pAny, { AggregateError } from 'p-any'
import { FilterError } from 'p-some'
import pSettle from 'p-settle'

import { TimeoutError } from './errors.js'
import { getCidFromSubdomainUrl } from './utils/cid.js'
import {
  CIDS_TRACKER_ID,
  SUMMARY_METRICS_ID,
  REDIRECT_COUNTER_METRICS_ID,
  CF_CACHE_MAX_OBJECT_SIZE,
  HTTP_STATUS_RATE_LIMITED,
  REQUEST_PREVENTED_RATE_LIMIT_CODE,
  TIMEOUT_CODE,
} from './constants.js'

/**
 * @typedef {Object} GatewayResponse
 * @property {Response} [response]
 * @property {string} url
 * @property {number} [responseTime]
 * @property {string} [reason]
 * @property {boolean} [aborted]
 *
 * @typedef {import('./env').Env} Env
 */

/**
 * Handle gateway request
 *
 * @param {Request} request
 * @param {Env} env
 * @param {import('./index').Ctx} ctx
 */
export async function gatewayGet(request, env, ctx) {
  const startTs = Date.now()
  const reqUrl = new URL(request.url)
  const cid = getCidFromSubdomainUrl(reqUrl)
  const pathname = reqUrl.pathname

  const cache = caches.default
  let res = await cache.match(request.url)

  if (res) {
    // Update cache metrics in background
    const responseTime = Date.now() - startTs

    ctx.waitUntil(
      updateSummaryCacheMetrics(request, env, res, responseTime, cid, {
        pathname,
      })
    )
    return res
  }

  const gatewayReqs = env.ipfsGateways.map((gwUrl) =>
    gatewayFetch(gwUrl, cid, request, env, {
      pathname,
      timeout: env.REQUEST_TIMEOUT,
    })
  )

  try {
    /** @type {GatewayResponse} */
    const winnerGwResponse = await pAny(gatewayReqs, {
      filter: (res) => res.response?.ok,
    })

    async function settleGatewayRequests() {
      // Wait for remaining responses
      const responses = await pSettle(gatewayReqs)
      const successFullResponses = responses.filter(
        (r) => r.value?.response?.ok
      )

      await Promise.all([
        // Filter out winner and update remaining gateway metrics
        ...responses
          .filter((r) => r.value?.url !== winnerGwResponse.url)
          .map((r) => updateGatewayMetrics(request, env, r.value, false)),
        updateCidsTracker(request, env, successFullResponses, cid),
      ])
    }

    ctx.waitUntil(
      (async () => {
        const contentLengthMb = Number(
          winnerGwResponse.response.headers.get('content-length')
        )

        await Promise.all([
          storeWinnerGwResponse(request, env, winnerGwResponse, cid, {
            pathname,
          }),
          settleGatewayRequests(),
          // Cache request URL in Cloudflare CDN if smaller than CF_CACHE_MAX_OBJECT_SIZE
          contentLengthMb <= CF_CACHE_MAX_OBJECT_SIZE &&
            cache.put(request.url, winnerGwResponse.response.clone()),
        ])
      })()
    )

    // forward winner gateway response
    return winnerGwResponse.response
  } catch (err) {
    let candidateResponse,
      wasTimeout = false
    const responses = await pSettle(gatewayReqs)

    // Redirect if all failed with rate limited error
    const wasRateLimited = responses.every(
      (r) =>
        r.value?.response?.status === HTTP_STATUS_RATE_LIMITED ||
        r.value?.reason === REQUEST_PREVENTED_RATE_LIMIT_CODE
    )

    // Return the error response from gateway, error is not from nft.storage Gateway
    if (err instanceof FilterError || err instanceof AggregateError) {
      candidateResponse = responses.find((r) => r.value?.response)

      // Gateway timeout
      if (
        !candidateResponse &&
        responses[0].value?.aborted &&
        responses[0].value?.reason == TIMEOUT_CODE
      ) {
        wasTimeout = true
      }
    }

    ctx.waitUntil(
      (async () => {
        // Update metrics as all requests failed
        await Promise.all(
          responses.map((r) =>
            updateGatewayMetrics(request, env, r.value, false)
          )
        )
        // Update errored if candidate response
        candidateResponse &&
          (await updateSummaryWinnerMetrics(request, env, cid, {
            errored: true,
          }))
        // Update redirect counter
        wasRateLimited && (await updateGatewayRedirectCounter(request, env))
      })()
    )

    if (wasRateLimited) {
      const ipfsUrl = new URL('ipfs', env.IPFS_GATEWAYS[0])
      return Response.redirect(`${ipfsUrl.toString()}/${cid}${pathname}`, 302)
    }

    // Return first response with upstream error
    if (candidateResponse) {
      return candidateResponse.value?.response
    }

    // Return timeout error if timeout
    if (wasTimeout) {
      throw new TimeoutError()
    }

    // Throw server error
    throw err
  }
}

/**
 * Store metrics for winner gateway response
 *
 * @param {Request} request
 * @param {Env} env
 * @param {GatewayResponse} gwResponse
 * @param {string} cid
 * @param {Object} [options]
 * @param {string} [options.pathname]
 */
async function storeWinnerGwResponse(
  request,
  env,
  gwResponse,
  cid,
  { pathname } = {}
) {
  await Promise.all([
    updateGatewayMetrics(request, env, gwResponse, true),
    updateSummaryWinnerMetrics(request, env, cid, { gwResponse, pathname }),
  ])
}

/**
 * Fetches given CID from given IPFS gateway URL.
 *
 * @param {string} gwUrl
 * @param {string} cid
 * @param {Request} request
 * @param {Env} env
 * @param {Object} [options]
 * @param {string} [options.pathname]
 * @param {number} [options.timeout]
 */
async function gatewayFetch(
  gwUrl,
  cid,
  request,
  env,
  { pathname = '', timeout = 60000 } = {}
) {
  // Block before hitting rate limit if needed
  const { shouldBlock } = await getGatewayRateLimitState(request, env, gwUrl)

  if (shouldBlock) {
    /** @type {GatewayResponse} */
    return {
      url: gwUrl,
      aborted: true,
      reason: REQUEST_PREVENTED_RATE_LIMIT_CODE,
    }
  }

  const ipfsUrl = new URL('ipfs', gwUrl)
  const controller = new AbortController()
  const startTs = Date.now()
  const timer = setTimeout(() => controller.abort(), timeout)

  let response
  try {
    response = await fetch(`${ipfsUrl.toString()}/${cid}${pathname}`, {
      signal: controller.signal,
      headers: getHeaders(request),
    })
  } catch (error) {
    if (controller.signal.aborted) {
      return {
        url: gwUrl,
        aborted: true,
        reason: TIMEOUT_CODE,
      }
    }
    throw error
  } finally {
    clearTimeout(timer)
  }

  /** @type {GatewayResponse} */
  const gwResponse = {
    response,
    url: gwUrl,
    responseTime: Date.now() - startTs,
  }
  return gwResponse
}

/**
 * @param {Request} request
 */
function getHeaders(request) {
  const existingProxies = request.headers.get('X-Forwarded-For')
    ? `, ${request.headers.get('X-Forwarded-For')}`
    : ''
  return {
    'X-Forwarded-For': `${request.headers.get(
      'cf-connecting-ip'
    )}${existingProxies}`,
    'X-Forwarded-Host': request.headers.get('host'),
  }
}

/**
 * @param {Request} request
 * @param {import('./env').Env} env
 * @param {Response} response
 * @param {number} responseTime
 * @param {string} cid
 * @param {Object} [options]
 * @param {string} [options.pathname]
 */
async function updateSummaryCacheMetrics(
  request,
  env,
  response,
  responseTime,
  cid,
  { pathname } = {}
) {
  // Get durable object for gateway
  const id = env.summaryMetricsDurable.idFromName(SUMMARY_METRICS_ID)
  const stub = env.summaryMetricsDurable.get(id)

  /** @type {import('./durable-objects/summary-metrics').FetchStats} */
  const contentLengthStats = {
    cid,
    errored: false,
    contentLength: Number(response.headers.get('content-length')),
    contentType: response.headers.get('content-type'),
    responseTime,
    pathname,
  }

  await stub.fetch(
    getDurableRequestUrl(request, 'metrics/cache', contentLengthStats)
  )
}
/**
 * @param {Request} request
 * @param {import('./env').Env} env
 */
async function updateGatewayRedirectCounter(request, env) {
  // Get durable object for counter
  const id = env.gatewayRedirectCounter.idFromName(REDIRECT_COUNTER_METRICS_ID)
  const stub = env.gatewayRedirectCounter.get(id)

  await stub.fetch(getDurableRequestUrl(request, 'update'))
}

/**
 * @param {Request} request
 * @param {import('./env').Env} env
 * @param {string} gwUrl
 */
async function getGatewayRateLimitState(request, env, gwUrl) {
  // Get durable object for gateway rate limits
  const id = env.gatewayRateLimitsDurable.idFromName(gwUrl)
  const stub = env.gatewayRateLimitsDurable.get(id)

  const stubResponse = await stub.fetch(
    getDurableRequestUrl(request, 'request')
  )

  /** @type {import('./durable-objects/gateway-rate-limits').RateLimitResponse} */
  const rateLimitResponse = await stubResponse.json()
  return rateLimitResponse
}

/**
 * @param {Request} request
 * @param {import('./env').Env} env
 * @param {string} cid
 * @param {Object} options
 * @param {GatewayResponse} [options.gwResponse]
 * @param {boolean} [options.errored]
 * @param {string} [options.pathname]
 */
async function updateSummaryWinnerMetrics(
  request,
  env,
  cid,
  { gwResponse, errored = false, pathname }
) {
  // Get durable object for gateway
  const id = env.summaryMetricsDurable.idFromName(SUMMARY_METRICS_ID)
  const stub = env.summaryMetricsDurable.get(id)

  /** @type {import('./durable-objects/summary-metrics').FetchStats} */
  const fetchStats = {
    cid,
    errored,
    contentLength: Number(gwResponse?.response.headers.get('content-length')),
    contentType: gwResponse?.response.headers.get('content-type'),
    responseTime: gwResponse?.responseTime,
    pathname,
  }

  await stub.fetch(getDurableRequestUrl(request, 'metrics/winner', fetchStats))
}

/**
 * @param {Request} request
 * @param {import('./env').Env} env
 * @param {GatewayResponse} gwResponse
 * @param {boolean} [isWinner = false]
 */
async function updateGatewayMetrics(
  request,
  env,
  gwResponse,
  isWinner = false
) {
  // Get durable object for gateway
  const id = env.gatewayMetricsDurable.idFromName(gwResponse.url)
  const stub = env.gatewayMetricsDurable.get(id)

  /** @type {import('./durable-objects/gateway-metrics').FetchStats} */
  const fetchStats = {
    status: gwResponse.response?.status,
    winner: isWinner,
    responseTime: gwResponse.responseTime,
    requestPreventedCode: gwResponse.reason,
  }

  await stub.fetch(getDurableRequestUrl(request, 'update', fetchStats))
}

/**
 * @param {Request} request
 * @param {import('./env').Env} env
 * @param {import('p-settle').PromiseResult<GatewayResponse>[]} responses
 * @param {string} cid
 */
async function updateCidsTracker(request, env, responses, cid) {
  const id = env.cidsTrackerDurable.idFromName(CIDS_TRACKER_ID)
  const stub = env.cidsTrackerDurable.get(id)

  /** @type {import('./durable-objects/cids').CidUpdateRequest} */
  const updateRequest = {
    cid,
    urls: responses.filter((r) => r.isFulfilled).map((r) => r?.value?.url),
  }

  await stub.fetch(getDurableRequestUrl(request, 'update', updateRequest))
}

/**
 * Get a Request to update a durable object
 *
 * @param {Request} request
 * @param {string} route
 * @param {any} [data]
 */
function getDurableRequestUrl(request, route, data) {
  const reqUrl = new URL(request.url)
  const durableReqUrl = new URL(route, `${reqUrl.protocol}//${reqUrl.host}`)
  const headers = new Headers()
  headers.append('Content-Type', 'application/json')

  return new Request(durableReqUrl.toString(), {
    headers,
    method: 'PUT',
    body: data && JSON.stringify(data),
  })
}
