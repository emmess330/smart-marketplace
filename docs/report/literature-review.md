# Literature Review

## 2.1 Search Technologies in E-commerce

Effective product search is a critical component of e-commerce platforms.
Traditional relational database search using SQL LIKE queries suffers from
significant limitations: it cannot handle typos, does not rank results by
relevance, and performs poorly at scale (Baeza-Yates and Ribeiro-Neto, 2011).
Modern e-commerce platforms require search systems that are fast, fault-tolerant,
and relevance-aware.

Elasticsearch, built on top of Apache Lucene, has emerged as the dominant
solution for e-commerce search (Gormley and Tong, 2015). It provides inverted
index structures that enable sub-second full-text search across millions of
documents. The inverted index maps each unique term to the list of documents
containing it, enabling constant-time lookup regardless of corpus size. This
contrasts sharply with sequential scan approaches used by relational databases
for text search.

A key feature of Elasticsearch relevant to this project is its support for
fuzzy matching using edit distance algorithms (Levenshtein, 1966). This allows
the system to return relevant results even when users make spelling mistakes,
which studies show occurs in approximately 10-15% of e-commerce search queries
(Spink et al., 2001). The BM25 ranking algorithm, which Elasticsearch uses by
default since version 5.0, improves on the classic TF-IDF model by normalising
for document length and providing better saturation of term frequency, producing
more accurate relevance scores (Robertson and Zaragoza, 2009).

Faceted search — the ability to filter results by categories, price ranges, and
other attributes — is identified by Tunkelang (2009) as one of the most important
features for e-commerce usability. By allowing users to progressively narrow
their result set through filters, faceted navigation reduces cognitive load and
improves conversion rates. This project implements faceted search using
Elasticsearch aggregations, which compute category counts and price statistics
in a single query alongside search results, avoiding the need for separate
database queries.

The system in this project uses a multi-field search approach, boosting the
product name field (^3) over description and applying a separate boost to tags
(^2). This field boosting strategy reflects the finding of Joachims et al. (2005)
that users assign higher relevance to matches in titles and key metadata compared
to body text. Autocomplete functionality is implemented using phrase prefix
queries, which provide real-time suggestions as users type, reducing search
abandonment (Shokouhi and Si, 2011).

## 2.2 Recommendation Systems in E-commerce

*(To be completed — collaborative filtering, content-based filtering, hybrid 
approaches. See Phase 4 implementation notes.)*

## 2.3 Sales Forecasting for Inventory Management

*(To be completed — time series forecasting, Prophet, ARIMA. See Phase 5 
implementation notes.)*

## References

Baeza-Yates, R. and Ribeiro-Neto, B. (2011) *Modern Information Retrieval: 
The Concepts and Technology behind Search*. 2nd edn. Harlow: Addison-Wesley.

Gormley, C. and Tong, Z. (2015) *Elasticsearch: The Definitive Guide*. 
Sebastopol: O'Reilly Media.

Joachims, T., Granka, L., Pan, B., Hembrooke, H. and Gay, G. (2005) 
'Accurately interpreting clickthrough data as implicit feedback', *Proceedings 
of the 28th Annual International ACM SIGIR Conference*, pp. 154–161.

Levenshtein, V.I. (1966) 'Binary codes capable of correcting deletions, 
insertions, and reversals', *Soviet Physics Doklady*, 10(8), pp. 707–710.

Robertson, S. and Zaragoza, H. (2009) 'The probabilistic relevance framework: 
BM25 and beyond', *Foundations and Trends in Information Retrieval*, 3(4), 
pp. 333–389.

Shokouhi, M. and Si, L. (2011) 'Federated search', *Foundations and Trends 
in Information Retrieval*, 5(1), pp. 1–102.

Spink, A., Wolfram, D., Jansen, B.J. and Saracevic, T. (2001) 'Searching the 
web: the public and their queries', *Journal of the American Society for 
Information Science and Technology*, 52(3), pp. 226–234.

Tunkelang, D. (2009) *Faceted Search*. San Rafael: Morgan and Claypool 
Publishers.




## 2.2 Recommendation Systems in E-commerce

Recommendation systems have become a cornerstone of modern e-commerce,
with Amazon reporting that 35% of its revenue is generated through product
recommendations (McKinsey, 2013). The academic literature identifies three
main approaches: collaborative filtering, content-based filtering, and hybrid
methods that combine both.

Collaborative filtering exploits the collective behaviour of users, operating
on the principle that users who agreed in the past will agree in the future
(Goldberg et al., 1992). Matrix factorisation techniques, particularly 
Singular Value Decomposition (SVD), decompose the user-item interaction matrix
into latent factor representations that capture underlying preferences. Koren
et al. (2009) demonstrated the effectiveness of matrix factorisation in the
Netflix Prize competition, showing that latent factor models outperform
neighbourhood-based methods for sparse interaction data. This project implements
TruncatedSVD from scikit-learn, which is computationally efficient for sparse
matrices and scales well as the user base grows.

Content-based filtering recommends items similar to those a user has previously
engaged with, based on item features rather than user behaviour (Lops et al.,
2011). This approach addresses the cold-start problem inherent in collaborative
filtering — new items with no interaction history can still be recommended based
on their attributes. In this project, content-based similarity is computed using
category membership, tag overlap, and price proximity, producing a composite
relevance score for each candidate product.

A key challenge in recommendation system evaluation is measuring quality without
live A/B testing infrastructure. This project uses offline evaluation metrics
standard in the literature: Precision@k measures the proportion of recommended
items that are relevant within the top k results, while Recall@k measures the
proportion of relevant items that appear in the top k recommendations (Herlocker
et al., 2004). These metrics provide a quantitative basis for comparing model
variants and justifying design decisions in the report.

The hybrid approach adopted in this project — falling back from collaborative
to content-based filtering when interaction data is sparse — follows the
recommendation of Burke (2002), who argues that hybrid systems consistently
outperform single-method approaches across different data density conditions.

## References (additions)

Burke, R. (2002) 'Hybrid recommender systems: survey and experiments', 
*User Modeling and User-Adapted Interaction*, 12(4), pp. 331–370.

Goldberg, D., Nichols, D., Oki, B.M. and Terry, D. (1992) 'Using collaborative
filtering to weave an information tapestry', *Communications of the ACM*, 
35(12), pp. 61–70.

Herlocker, J.L., Konstan, J.A., Terveen, L.G. and Riedl, J.T. (2004) 
'Evaluating collaborative filtering recommender systems', *ACM Transactions 
on Information Systems*, 22(1), pp. 5–53.

Koren, Y., Bell, R. and Volinsky, C. (2009) 'Matrix factorization techniques
for recommender systems', *Computer*, 42(8), pp. 30–37.

Lops, P., de Gemmis, M. and Semeraro, G. (2011) 'Content-based recommender
systems: state of the art and trends', in Ricci, F. et al. (eds) 
*Recommender Systems Handbook*. Boston: Springer, pp. 73–105.

McKinsey Global Institute (2013) *The Social Economy: Unlocking Value and 
Productivity Through Social Technologies*. New York: McKinsey and Company.