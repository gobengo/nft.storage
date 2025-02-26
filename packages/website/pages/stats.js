import { useEffect, useState } from 'react'
import { TrustedBy } from '../components/trustedByLogos'
import fs from 'fs'
import decorateAdditionalCalculatedValues, {
  formatBytes,
} from '../lib/statsUtils'
import { API } from '../lib/api'
import Loading from '../components/loading'
import { abbreviateNumber } from 'js-abbreviation-number'

/**
 *
 * @returns {{ props: import('../components/types.js').LayoutProps}}
 */
export function getStaticProps() {
  const logos = fs.readdirSync('public/images/marketplace-logos/home')
  // make opensea be the first logo
  const logosWithDir = logos
    .sort((a, b) =>
      a.includes('opensea') ? -1 : b.includes('opensea') ? 1 : 0
    )
    .map((logo) => {
      const cleanedFileName = logo.replace(/\.[^/.]+$/, '')
      return {
        src: `home/${logo}`,
        alt: cleanedFileName + ' logo',
      }
    })
  return {
    props: {
      title: 'Stats - NFT Storage',
      description: 'NFT.Storage usage stats',
      navBgColor: 'bg-nsgreen',
      needsUser: false,
      logos: logosWithDir,
    },
  }
}

/**
 * Stats Page
 * @param {Object} props
 * @param {string[]} props.logos
 *
 */
export default function Stats({ logos }) {
  /** @type [any, any] */
  const [stats, setStats] = useState({})
  const [statsLoading, setStatsLoading] = useState(false)

  useEffect(() => {
    fetchStats()
  }, [])

  async function fetchStats() {
    setStatsLoading(true)
    try {
      const stats = await fetch(`${API}/stats`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      }).then((res) => res.json())
      setStats(decorateAdditionalCalculatedValues(stats.data))
    } catch (e) {
      const fakeData = {
        ok: true,
        data: {
          deals_size_total: 249523372029443,
          uploads_past_7_total: 2011366,
          uploads_nft_total: 685866,
          uploads_remote_total: 11077834,
          deals_total: 34959,
          uploads_car_total: 17711308,
          uploads_multipart_total: 1456388,
          uploads_blob_total: 12420729,
        },
      }
      setStats(decorateAdditionalCalculatedValues(fakeData.data))
    }
    setStatsLoading(false)
  }

  const Marquee = () => {
    return (
      <div className="marquee">
        <div className="marquee-track">
          <p className="marquee-text chicagoflf">NFT.Storage is storing...</p>
        </div>
      </div>
    )
  }

  /**
   * @param {Object} props
   * @param {string} [props.title]
   * @param {any} [props.children]
   */
  const StatCard = ({ title, children }) => {
    return (
      <div className="stat-card">
        <h2 className="stat-card-header chicagoflf">{title}</h2>
        <div className="stat-card-inner">{children}</div>
      </div>
    )
  }

  const StatCards = () => {
    return (
      <div className="stat-cards-wrapper">
        <div className="mw9 center pv3 ph3 ph5-ns">
          <div className="stat-cards">
            <StatCard title="Upload Count">
              <div>
                <img
                  src={'/images/stats-upload-count.svg'}
                  alt="Upload Count"
                />
                <div className="pv3 ph3">
                  <p className="chicagoflf">Total uploads to NFT.Storage</p>
                  <figure className="chicagoflf">
                    {statsLoading && <Loading />}
                    {abbreviateNumber(stats.totalUploads || 0, 1)}
                  </figure>
                  <p
                    className={`chicagoflf ${
                      stats.growthRate > 0
                        ? 'stat-green stat-green-plus'
                        : 'stat-red'
                    }`}
                  >
                    {stats.growthRate || 0}%
                  </p>
                  <p>[Week over week change]</p>
                </div>
              </div>
            </StatCard>

            <StatCard title="Data Stored">
              <div>
                <img src={'/images/stats-data-stored.svg'} alt="Data Stored" />
                <div className="pv3 ph3">
                  <p className="chicagoflf">
                    Total data stored on Filecoin from NFT.Storage
                  </p>
                  <figure className="chicagoflf">
                    {statsLoading && <Loading />}
                    {formatBytes(stats.deals_size_total || 0, 2)}
                  </figure>
                  <p
                    className={`chicagoflf ${
                      stats.deals_total > 0 ? 'stat-green' : 'stat-red'
                    }`}
                  >
                    {stats.deals_total?.toLocaleString() || 0}
                  </p>
                  <p>[Total deals]</p>
                </div>
              </div>
            </StatCard>
          </div>
        </div>
      </div>
    )
  }

  return (
    <main className="bg-nsgreen">
      <Marquee />
      <StatCards />
      <div className="bg-nsblue">
        <div className="stats-trusted-wrapper mw9 center pv3 ph3 ph5-ns">
          <div>
            <TrustedBy logos={logos} />
          </div>
        </div>
      </div>
    </main>
  )
}
