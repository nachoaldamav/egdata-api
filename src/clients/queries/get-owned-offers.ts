import { gql } from "graphql-request";

export const ValidationErrorOfferFragment = gql`
  fragment ValidationErrorOffer on ValidationErrorOffer {
    namespace
    offerId
  }
`;

export const ValidationErrorItemFragment = gql`
  fragment ValidationErrorItem on ValidationErrorItem {
    namespace
    itemId
  }
`;

export const ValidationOfferConflictFragment = gql`
  fragment ValidationOfferConflict on ValidationOfferConflict {
    namespace
    offerId
    conflictingOffers {
      ...ValidationErrorOffer
    }
  }
  ${ValidationErrorOfferFragment}
`;

export const ValidationMissingPrereqFragment = gql`
  fragment ValidationMissingPrereq on ValidationMissingPrereq {
    namespace
    offerId
    missingPrerequisiteItems {
      ...ValidationErrorItem
    }
  }
  ${ValidationErrorItemFragment}
`;

export const GetOffersValidationDocument = gql`
  query getOffersValidation($offers: [OfferToValidate]!) {
    Entitlements {
      cartOffersValidation(offerParams: $offers) {
        conflictingOffers {
          ...ValidationOfferConflict
        }
        missingPrerequisites {
          ...ValidationMissingPrereq
        }
        fullyOwnedOffers {
          ...ValidationErrorOffer
        }
        possiblePartialUpgradeOffers {
          ...ValidationErrorOffer
        }
        unablePartiallyUpgradeOffers {
          ...ValidationErrorOffer
        }
      }
    }
  }
  ${ValidationOfferConflictFragment}
  ${ValidationMissingPrereqFragment}
  ${ValidationErrorOfferFragment}
`;

export interface ValidationErrorOffer {
  namespace: string;
  offerId: string;
}

export interface ValidationErrorItem {
  namespace: string;
  itemId: string;
}

export interface ValidationOfferConflict {
  namespace: string;
  offerId: string;
  conflictingOffers: ValidationErrorOffer[];
}

export interface ValidationMissingPrereq {
  namespace: string;
  offerId: string;
  missingPrerequisiteItems: ValidationErrorItem[];
}

export interface OfferToValidate {
  namespace: string;
  offerId: string;
}

export interface GetOffersValidationQuery {
  Entitlements: {
    cartOffersValidation: {
      conflictingOffers: ValidationOfferConflict[];
      missingPrerequisites: ValidationMissingPrereq[];
      fullyOwnedOffers: ValidationErrorOffer[];
      possiblePartialUpgradeOffers: ValidationErrorOffer[];
      unablePartiallyUpgradeOffers: ValidationErrorOffer[];
    };
  };
}

export interface GetOffersValidationQueryVariables {
  offers: OfferToValidate[];
}
