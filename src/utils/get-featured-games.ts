const EPIC_STORE_FRONT =
  'https://store-site-backend-static-ipv4.ak.epicgames.com/storefrontLayout?locale=en-US&country=ES&start=0&count=9';

export async function getFeaturedGames(): Promise<
  { namespace: string; id: string }[]
> {
  const response = await fetch(EPIC_STORE_FRONT);
  const data = (await response.json()) as Root;

  // Get the module that it's ID is new-carousel-definitive
  const module = data.data.Storefront.storefrontModulesPaginated.modules.find(
    (module) => module.id === 'new-carousel-definitive'
  ) as Module;

  // Get all the offers IDs and namespaces
  const offers = module.slides?.map((slide) => slide.offer) as Offer4[];

  return offers;
}

interface Root {
  data: Data;
  extensions: Extensions;
}

interface Data {
  Storefront: Storefront;
}

interface Storefront {
  storefrontModulesPaginated: StorefrontModulesPaginated;
}

interface StorefrontModulesPaginated {
  modules: Module[];
  paging: Paging;
}

interface Module {
  id: string;
  type: string;
  title: string;
  modules?: Module2[];
  slides?: Slide[];
  link?: Link3;
  titleIcon?: string;
  hideTitle?: boolean;
  groupStyle?: string;
  offerType?: string;
  offerPresentation?: string;
  cardType?: string;
  offers?: Offer5[];
}

interface Module2 {
  id: string;
  type: string;
  title: string;
  titleGroup?: string;
  description?: string;
  backgroundColors: any;
  layout?: string;
  action?: string;
  couponSlug: any;
  eyebrow: any;
  videoRecipe: any;
  link: Link;
  image?: Image;
  regionRestrictions?: RegionRestrictions;
  offer?: Offer;
  titleIcon?: string;
  hideTitle?: boolean;
  groupStyle?: string;
  offerType?: string;
  offerPresentation?: string;
  cardType?: string;
  offers?: Offer2[];
}

interface Link {
  src: string;
  linkText: string;
}

interface Image {
  src: string;
  alt: string;
}

interface RegionRestrictions {
  filterType: string;
  appliedCountries: string;
}

interface Offer {
  namespace: string;
  id: string;
}

interface Offer2 {
  namespace: string;
  id: string;
  offer: Offer3;
}

interface Offer3 {
  title: string;
  id: string;
  namespace: string;
  offerType: string;
  expiryDate?: string;
  status: string;
  isCodeRedemptionOnly: boolean;
  description: string;
  effectiveDate: string;
  viewableDate?: string;
  pcReleaseDate?: string;
  releaseDate: string;
  approximateReleasePlan?: ApproximateReleasePlan;
  prePurchase?: boolean;
  keyImages: KeyImage[];
  seller: Seller;
  productSlug?: string;
  urlSlug: string;
  items: Item[];
  customAttributes: CustomAttribute[];
  developerDisplayName?: string;
  publisherDisplayName?: string;
  categories: Category[];
  catalogNs: CatalogNs;
  offerMappings: OfferMapping[];
  price: Price;
  linkedOfferId: any;
  linkedOffer: any;
  countriesBlacklist?: string[];
  countriesWhitelist?: string[];
  tags: Tag[];
}

interface ApproximateReleasePlan {
  day?: number;
  month?: number;
  quarter: any;
  year?: number;
  releaseDateType: string;
}

interface KeyImage {
  type: string;
  url: string;
}

interface Seller {
  id: string;
  name: string;
}

interface Item {
  id: string;
  namespace: string;
}

interface CustomAttribute {
  key: string;
  value: string;
}

interface Category {
  path: string;
}

interface CatalogNs {
  mappings: Mapping[];
}

interface Mapping {
  pageSlug: string;
  pageType: string;
}

interface OfferMapping {
  pageSlug: string;
  pageType: string;
}

interface Price {
  totalPrice: TotalPrice;
  lineOffers: LineOffer[];
}

interface TotalPrice {
  discountPrice: number;
  originalPrice: number;
  voucherDiscount: number;
  discount: number;
  fmtPrice: FmtPrice;
  currencyCode: string;
  currencyInfo: CurrencyInfo;
}

interface FmtPrice {
  originalPrice: string;
  discountPrice: string;
  intermediatePrice: string;
}

interface CurrencyInfo {
  decimals: number;
  symbol: string;
}

interface LineOffer {
  appliedRules: AppliedRule[];
}

interface AppliedRule {
  id: string;
  endDate: string;
}

interface Tag {
  id: string;
}

interface Slide {
  title: string;
  eyebrow: string;
  description: string;
  textColor?: string;
  accentColor?: string;
  textAccentColor?: string;
  theme: Theme;
  image: Image2;
  mobileImage: MobileImage;
  logoImage: LogoImage;
  thumbnail: Thumbnail;
  link: Link2;
  videoRecipe: any;
  regionRestrictions: RegionRestrictions2;
  offer: Offer4;
}

interface Theme {
  preferredMode: any;
  light: Light;
  dark: Dark;
}

interface Light {
  theme: any;
  accent: any;
}

interface Dark {
  theme: any;
  accent: any;
}

interface Image2 {
  src: string;
  altText: string;
}

interface MobileImage {
  src: string;
  altText: string;
}

interface LogoImage {
  src: string;
  altText: string;
}

interface Thumbnail {
  src: string;
  altText: string;
}

interface Link2 {
  src: string;
  linkText: string;
}

interface RegionRestrictions2 {
  filterType: string;
  appliedCountries: string;
}

interface Offer4 {
  namespace: string;
  id: string;
}

interface Link3 {
  src: string;
  linkText: string;
}

interface Offer5 {
  namespace: string;
  id: string;
  offer: Offer6;
}

interface Offer6 {
  title: string;
  id: string;
  namespace: string;
  offerType: string;
  expiryDate: any;
  status: string;
  isCodeRedemptionOnly: boolean;
  description: string;
  effectiveDate: string;
  viewableDate?: string;
  pcReleaseDate?: string;
  releaseDate: string;
  approximateReleasePlan: any;
  prePurchase?: boolean;
  keyImages: KeyImage2[];
  seller: Seller2;
  productSlug?: string;
  urlSlug: string;
  items: Item2[];
  customAttributes: CustomAttribute2[];
  developerDisplayName?: string;
  publisherDisplayName?: string;
  categories: Category2[];
  catalogNs: CatalogNs2;
  offerMappings: OfferMapping2[];
  price: Price2;
  linkedOfferId: any;
  linkedOffer: any;
  countriesBlacklist?: string[];
  countriesWhitelist?: string[];
  tags: Tag2[];
}

interface KeyImage2 {
  type: string;
  url: string;
}

interface Seller2 {
  id: string;
  name: string;
}

interface Item2 {
  id: string;
  namespace: string;
}

interface CustomAttribute2 {
  key: string;
  value: string;
}

interface Category2 {
  path: string;
}

interface CatalogNs2 {
  mappings: Mapping2[];
}

interface Mapping2 {
  pageSlug: string;
  pageType: string;
}

interface OfferMapping2 {
  pageSlug: string;
  pageType: string;
}

interface Price2 {
  totalPrice: TotalPrice2;
  lineOffers: LineOffer2[];
}

interface TotalPrice2 {
  discountPrice: number;
  originalPrice: number;
  voucherDiscount: number;
  discount: number;
  fmtPrice: FmtPrice2;
  currencyCode: string;
  currencyInfo: CurrencyInfo2;
}

interface FmtPrice2 {
  originalPrice: string;
  discountPrice: string;
  intermediatePrice: string;
}

interface CurrencyInfo2 {
  decimals: number;
  symbol: string;
}

interface LineOffer2 {
  appliedRules: AppliedRule2[];
}

interface AppliedRule2 {
  id: string;
  endDate: string;
}

interface Tag2 {
  id: string;
}

interface Paging {
  start: number;
  count: number;
  total: number;
}

interface Extensions {}
