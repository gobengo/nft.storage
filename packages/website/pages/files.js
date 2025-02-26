import { API, getNfts, getToken } from '../lib/api.js'
import { useQuery, useQueryClient } from 'react-query'
import { VscQuestion } from 'react-icons/vsc'
import { CID } from 'multiformats/cid'
import Button from '../components/button.js'
import Tooltip from '../components/tooltip.js'
import Loading from '../components/loading'
import { MOCK_FILES } from '../lib/mock_files'
import { formatTimestamp } from '../lib/format'
import { NFTStorage } from 'nft.storage'
import Script from 'next/script'
import { When } from 'react-if'
import bytes from 'bytes'
import countly from '../lib/countly.js'
import { useState } from 'react'
import CopyButton from '../components/copyButton'
import { Popover, ArrowContainer } from 'react-tiny-popover'
import clsx from 'clsx'

/**
 * Static Props
 *
 * @returns {{ props: import('../components/types.js').LayoutProps}}
 */
export function getStaticProps() {
  return {
    props: {
      title: 'Files - NFT Storage',
      navBgColor: 'bg-nsyellow',
      redirectTo: '/',
      needsUser: true,
    },
  }
}

/**
 * Files Page
 *
 * @param {import('../components/types.js').LayoutChildrenProps} props
 * @returns
 */
export default function Files({ user }) {
  const [deleting, setDeleting] = useState('')
  const [limit] = useState(25)
  const [befores, setBefores] = useState([''])
  const queryClient = useQueryClient()
  const queryParams = { before: befores[0], limit }
  /** @type {[string, { before: string, limit: number }]} */
  const queryKey = ['get-nfts', queryParams]
  const [isActionMenuOpen, setIsActionMenuOpen] = useState('')

  let isDev
  if (!!globalThis.window && location.host === 'localhost:4000') isDev = true

  const { status, data } = useQuery(
    queryKey,
    (ctx) => getNfts(ctx.queryKey[1]),
    {
      enabled: !!user,
      refetchOnWindowFocus: false,
    }
  )

  /** @type {any[]} */
  const nfts = isDev ? MOCK_FILES : data || []

  /**
   * @param {import('react').ChangeEvent<HTMLFormElement>} e
   */

  async function handleDeleteFile(e) {
    e.preventDefault()
    const data = new FormData(e.target)
    const cid = data.get('cid')
    if (cid && typeof cid === 'string') {
      if (!confirm('Are you sure? Deleted files cannot be recovered!')) {
        return
      }
      setDeleting(cid)
      try {
        const client = new NFTStorage({
          token: await getToken(),
          endpoint: new URL(API + '/'),
        })
        await client.delete(cid)
      } finally {
        await queryClient.invalidateQueries('get-nfts')
        setDeleting('')
      }
    }
  }

  function handlePrevClick() {
    if (befores.length === 1) return
    setBefores(befores.slice(1))
  }

  function handleNextClick() {
    if (nfts.length === 0) return
    setBefores([nfts[nfts.length - 1].created, ...befores])
  }

  function handleFirstClick() {
    setBefores([''])
  }

  const hasZeroNfts = nfts.length === 0 && befores.length === 1

  /**
   * @param {any} nft
   */
  const TableItem = ({ nft }) => {
    // to do, add actual types
    const [showAllDeals, setShowAllDeals] = useState(false)
    const deals = nft.deals
      .filter((/** @type {any} */ d) => d.status !== 'queued')
      .map(
        (
          /** @type {any} */ deal,
          /** @type {number} */ i,
          /** @type {any[]} */ deals
        ) => {
          const url = `https://filfox.info/en/deal/${deal.chainDealID}`
          return (
            <span key={deal.chainDealID} title={deal.status}>
              <a
                className="underline black"
                href={url}
                target="_blank"
                rel="noreferrer"
              >
                {deal.miner}
              </a>
              {i === deals.length - 1 ? '' : ', '}
            </span>
          )
        }
      )

    const queuedDeals =
      (nft.deals &&
        nft.deals.filter((/** @type {any} */ d) => d.status === 'queued')) ||
      []
    if (queuedDeals.length) {
      const message = `The content from this upload has been aggregated for storage on Filecoin and is queued for deals with ${
        queuedDeals.length
      } storage provider${
        queuedDeals.length > 1 ? 's' : ''
      }. Filecoin deals will be active within 48 hours of upload.`
      deals.push(
        <span
          key={nft.cid + '-pending'}
          aria-describedby="queued-deals-tooltip"
        >
          {`${deals.length ? ', ' : ''}${queuedDeals.length} pending`}
          <Tooltip
            placement="top"
            overlay={<span>{message}</span>}
            overlayClassName=""
            id="queued-deals-tooltip"
          >
            <VscQuestion size={16} />
          </Tooltip>
        </span>
      )
    }

    const dealsHidden = deals.splice(3)

    if (!nft.deals.length) {
      deals.push(
        <span
          className="queuing flex items-center"
          key="queuing"
          aria-describedby="all-deals-queued-tooltip"
        >
          Queuing
          <Tooltip
            overlay={
              <span>
                The content from this upload is being aggregated for redundant
                storage on Filecoin. Filecoin deals will be active within 48
                hours of upload. While Queuing, data is still available on the
                IPFS network.
              </span>
            }
            overlayClassName="ns-tooltip"
            id="all-deals-queued-tooltip"
          >
            <VscQuestion size={16} />
          </Tooltip>
        </span>
      )
    }

    return (
      <tr className="bg-white bb">
        <td data-label="Date" className="nowrap" title={nft.created}>
          {/* {nft.created.split('T')[0]} */}
          {formatTimestamp(nft.created)}
        </td>
        <td data-label="CID" className="nowrap">
          <CopyButton
            title="Copy CID to Clipboard"
            text={nft.cid}
            popupContent={'CID has been copied!!'}
          >
            <a
              href={`https://nftstorage.link/ipfs/${nft.cid}`}
              className="underline black truncate"
              target="_blank"
              rel="noreferrer"
            >
              {nft.cid}
            </a>
          </CopyButton>
        </td>
        <td data-label="Pin Status" className="nowrap">
          {nft.pin.status.charAt(0).toUpperCase() + nft.pin.status.slice(1)}
        </td>
        <td data-label="Deals">
          <div className="lh-copy">
            {deals}
            {dealsHidden.length > 0 && (
              <>
                {!showAllDeals && (
                  <button
                    onClick={() => setShowAllDeals(true)}
                    className="hidden-deals-trigger pointer"
                  >
                    +{dealsHidden.length} More
                  </button>
                )}
                {showAllDeals && (
                  <div className="hidden-deals">{dealsHidden}</div>
                )}
              </>
            )}
          </div>
        </td>
        <td data-label="Size" className="nowrap">
          {bytes(nft.size || 0)}
        </td>
        <td className="shrink-cell center-cell">
          <Popover
            isOpen={isActionMenuOpen === nft.cid}
            onClickOutside={(e) => {
              if (e.currentTarget !== null) {
                if (
                  e.target instanceof Element &&
                  e.target.getAttribute('data-cid')
                ) {
                  const cid = e.target.getAttribute('data-cid')
                  setIsActionMenuOpen(cid || '')
                } else {
                  setIsActionMenuOpen('')
                }
              }
            }}
            positions={['bottom', 'left', 'top', 'right']} // preferred positions by priority
            padding={2}
            content={({ position, childRect, popoverRect }) => (
              <ArrowContainer
                position={position}
                childRect={childRect}
                popoverRect={popoverRect}
                arrowColor={'black'}
                arrowSize={6}
                className="popover-arrow-container"
                arrowClassName="popover-arrow"
              >
                <div className="actions-menu">
                  <GatewayLink cid={nft.cid} type={nft.type} />
                  <CopyIpfsUrl cid={nft.cid} type={nft.type} />
                  <CopyCID cid={nft.cid} type={nft.type} />
                  <form onSubmit={handleDeleteFile}>
                    <input type="hidden" name="cid" value={nft.cid} />
                    <Button
                      type="submit"
                      disabled={Boolean(deleting)}
                      className="caution"
                      hologram={false}
                      id="delete-nft"
                      tracking={{
                        event: countly.events.FILE_DELETE_CLICK,
                        ui: countly.ui.FILES,
                        action: 'Delete File',
                      }}
                    >
                      {deleting === nft.cid ? 'Deleting...' : 'Delete File'}
                    </Button>
                  </form>
                </div>
              </ArrowContainer>
            )}
          >
            <button
              onClick={() => setIsActionMenuOpen(nft.cid)}
              className={`${
                isActionMenuOpen === nft.cid ? 'actions-trigger--active' : ''
              } btn small actions-trigger`}
              data-cid={nft.cid}
            >
              Actions
            </button>
          </Popover>
        </td>
      </tr>
    )
  }

  return (
    <>
      <Script src="//embed.typeform.com/next/embed.js" />
      <main className="bg-nsyellow flex-grow-1">
        <div className="mw9 center pv3 ph3 ph5-ns">
          <When condition={status === 'loading'}>
            <Loading />
          </When>
          <When condition={status !== 'loading'}>
            <>
              <div className="flex items-center mb3">
                <div className="flex-auto chicagoflf mv3">
                  <h1>Files</h1>
                </div>
                <Button
                  href={{
                    pathname: '/new-file',
                  }}
                  className="flex-none"
                  id="upload"
                  tracking={{
                    ui: countly.ui.FILES,
                    action: 'Upload File',
                  }}
                >
                  + Upload
                </Button>
              </div>
              <div className="table-responsive">
                <When condition={hasZeroNfts}>
                  <p className="tc mv5">
                    <span className="f1 dib mb3">😢</span>
                    <br />
                    No files
                  </p>
                </When>
                <When condition={!hasZeroNfts}>
                  <>
                    <table className="w-100 collapse">
                      <thead>
                        <tr className="bg-nsgray">
                          <th>Date</th>
                          <th>
                            <span aria-describedby="cid-tooltip">
                              CID
                              <Tooltip
                                placement="top"
                                overlay={
                                  <span>
                                    The content identifier for a file or piece
                                    of data.{' '}
                                    <a
                                      href="https://nftschool.dev/concepts/content-addressing/"
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      Learn more
                                    </a>
                                  </span>
                                }
                                overlayClassName="ns-tooltip"
                                id="cid-tooltip"
                              >
                                <VscQuestion size={16} />
                              </Tooltip>
                            </span>
                          </th>
                          <th>
                            <span aria-describedby="pin-status-tooltip">
                              Pin Status
                              <Tooltip
                                placement="top"
                                overlay={
                                  <span>
                                    Reports the status of a file or piece of
                                    data stored on the IPFS Cluster. Status
                                    might not be fully up-to-date. Data is still
                                    available even when in Queued state.
                                  </span>
                                }
                                overlayClassName="ns-tooltip"
                                id="pin-status-tooltip"
                              >
                                <VscQuestion size={16} />
                              </Tooltip>
                            </span>
                          </th>
                          <th>
                            <span aria-describedby="storage-providers-tooltip">
                              Storage Providers
                              <Tooltip
                                placement="top"
                                overlay={
                                  <span>
                                    Filecoin storage providers provably storing
                                    replicas of this data.{' '}
                                    <a
                                      href="https://filecoin.io/blog/posts/what-sets-us-apart-filecoin-s-proof-system/"
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      Learn more
                                    </a>
                                  </span>
                                }
                                overlayClassName="ns-tooltip"
                                id="storage-providers-tooltip"
                              >
                                <VscQuestion size={16} />
                              </Tooltip>
                            </span>
                          </th>
                          <th>Size</th>
                          <th>
                            <span className="sr-only">File Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {nfts.map(
                          (/** @type {any} */ nft, /** @type {number} */ i) => (
                            <TableItem nft={nft} key={`nft-${i}`} />
                          )
                        )}
                      </tbody>
                    </table>
                    <div className="flex flex-wrap justify-center tc mv3">
                      <Button
                        className="mh2 mb2"
                        disabled={befores.length === 1}
                        onClick={handleFirstClick}
                        id="files-first"
                        tracking={{
                          event: countly.events.FILES_NAVIGATION_CLICK,
                          ui: countly.ui.FILES,
                          action: 'First',
                        }}
                      >
                        ⇤ First
                      </Button>
                      <Button
                        className="mh2 mb2"
                        disabled={befores.length === 1}
                        onClick={handlePrevClick}
                        id="files-previous"
                        tracking={{
                          event: countly.events.FILES_NAVIGATION_CLICK,
                          ui: countly.ui.FILES,
                          action: 'Previous',
                        }}
                      >
                        ← Previous
                      </Button>
                      <Button
                        className="mh2 mb2"
                        disabled={nfts.length < limit}
                        onClick={handleNextClick}
                        id="files-next"
                        tracking={{
                          event: countly.events.FILES_NAVIGATION_CLICK,
                          ui: countly.ui.FILES,
                          action: 'Next',
                        }}
                      >
                        Next →
                      </Button>
                    </div>
                  </>
                </When>
              </div>
            </>
          </When>
          <div
            className={clsx(
              'flex justify-center pt4',
              status === 'loading' && 'hidden'
            )}
          >
            <Button data-tf-popup="OTxv3w2O" className="mh3 mb3" variant="dark">
              {'Tell us how we are doing'}
            </Button>
          </div>
        </div>
      </main>
    </>
  )
}

/**
 * Gateway Link Component
 *
 * @param {{cid: string, type?: string}} props
 */
function GatewayLink({ cid, type }) {
  const gatewayLink = `https://nftstorage.link/ipfs/${cid}`
  const href = type === 'nft' ? `${gatewayLink}/metadata.json` : gatewayLink
  const btnLabel = type === 'nft' ? 'View Metadata' : 'View URL'
  const btnTitle = type === 'nft' ? 'View Metadata JSON' : 'View URL'
  return (
    <a title={btnTitle} href={href} target="_blank" rel="noreferrer">
      {btnLabel}
    </a>
  )
}

/**
 * Copy the IPFS URL (ipfs://<cid>)
 *
 * @param {{cid: string, type?: string}} props
 */
function CopyIpfsUrl({ cid, type }) {
  const url = `ipfs://${CID.parse(cid).toV1()}`
  const href = type === 'nft' ? `${url}/metadata.json` : url

  return (
    <CopyButton
      title="Copy IPFS URL to Clipboard"
      text={href}
      popupContent={'IPFS URL has been copied!'}
      asLink={true}
    >
      <>Copy IPFS URL</>
    </CopyButton>
  )
}

/**
 * CID Copy Component
 *
 * @param {{cid: string, type?: string}} props
 */
function CopyCID({ cid }) {
  return (
    <CopyButton
      title="Copy CID to Clipboard"
      text={cid}
      popupContent={'CID has been copied!'}
      asLink={true}
    >
      <>Copy CID</>
    </CopyButton>
  )
}
