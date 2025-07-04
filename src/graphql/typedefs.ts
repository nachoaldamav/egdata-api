export const typeDefs = `#graphql
    scalar Date

    type Query {
        offer(id: ID!): Offer
    }

    type OfferMappings {
        pageSlug: String
        pageType: String
        _id: String
    }

    type IsBlockchainUsed {
        type: String
        value: String
    }

    type IsManuallySetPcReleaseDate {
        type: String
        value: String
    }

    type IsPromotionalContentUsed {
        type: String
        value: String
    }

    type IsManuallySetViewableDate {
        type: String
        value: String
    }

    type AutoGeneratedPrice {
        type: String
        value: String
    }

    type CustomAttribute {
        key: String
        value: String
        type: String
        _id: ID
    }

    type Items {
        id: String
        namespace: String
        _id: String
    }

    type Tags {
        id: String
        name: String
    }

    type Seller {
        id: String
        name: String
    }

    type KeyImages {
        type: String
        url: String
        md5: String
    }

    type Offer {
        _id: String
        id: String
        namespace: String
        title: String
        description: String
        longDescription: String
        offerType: String
        effectiveDate: Date
        creationDate: Date
        lastModifiedDate: Date
        isCodeRedemptionOnly: Boolean
        productSlug: String
        urlSlug: String
        url: String
        developerDisplayName: String
        publisherDisplayName: String
        prePurchase: String
        releaseDate: Date
        pcReleaseDate: Date
        viewableDate: Date
        countriesBlacklist: [String]
        countriesWhitelist: [String]
        refundType: String
        offerMappings: [OfferMappings]
        categories: [String]
        customAttributes: [CustomAttribute]
        items: [Items]
        tags: [Tags]
        seller: Seller
        keyImages: [KeyImages]
    }
`;
