# Introduction

The activity schema specification describes the *structure* of an activity schema, but does not cover the *implementation* of an activity schema on a warehouse. 

This document discusses some best practices when building an activity schema in production, informed by Narrator's experience building and evolving an activity schema. 

> Here we frequently refer back to [Narrator's](https://www.narratordata.com) approach -- only because it's the one known end-to-end implementation as of this writing. As more are created this doc will include them as well. 

<br>

# Implementation Stages

An activity schema differs from dimensional modeling in how it is created, maintained, and queried. Most implementations of an activity schema will cover all of these cases. 

For the purposes of this doc they're split up into three stages: structure, processing, and querying.

<br>

## Structure

This covers how to set up the tables for an activity stream. Most of the complexity is around how to sort / partition for best query performance. In general queries to an activity schema will filter or group by activity and time, so it's best to align around those.

<br>

### Single activity stream table

Redshift
 - diststyle="EVEN"
 - sortkey='"activity", "ts", "activity_occurrence"'

BigQuery
 - clusterkey="activity, activity_occurrence, customer"
 - partition_column="TIMESTAMP_TRUNC(ts, MONTH)"

Snowflake
 - cluster_column="(activity, activity_occurrence in (1, NULL), activity_repeated_at is NULL, to_date(ts))"

Athena
  - partitioned_by="activity VARCHAR(255), activity_occurrence INT, DATE(ts)"
			 
Databricks
 - partition_by="activity, DATE(ts)"
 - cluster_by="customer, activity_occurrence"
  
Postgres
 - Postgres is a bit of a special case but can be used as a warehouse. For implementation instructions this [blog](https://www.narratordata.com/blog/using-postgresql-as-a-data-warehouse/) goes in-depth

<br>

> For BigQuery it's highly recommended to run one table per activity instead of a single activity stream table. This is because BigQuery can't partition by both activity and time. 

<br>

### One table per activity

Managing one table per activity can improve performance for large activity streams, particularly on BigQuery.  

Redshift
 - diststyle="EVEN",
 - sortkey='"ts", "activity_occurrence"'

Bigquery
 - clusterkey="activity_occurrence, customer"
 - partition_column="TIMESTAMP_TRUNC(ts, MONTH)"

Snowflake
 - cluster_column="(activity_occurrence in (1, NULL), activity_repeated_at is NULL, to_date(ts))"

Athena
 - partitioned_by="activity_occurrence INT, DATE(ts) DATE"


<br>

## Processing
Processing 

Maintaining an activity schema implementation requires these steps

- periodically run transformation SQL queries and insert the results into the activity stream table(s)
- on updates to the activity stream fill in the **activity_occurrence** and **activity_repeated_at** columns
- if **anonymous_customer_id** is used, periodically scan the activity stream and fill in **customer** for the **anonymous_customer_id** that has been identified.

<br>

### dbt

dbt is built for processing data on a schedule. It can definitely be used to create and maintain an activity stream. We're not aware of any implementations running in production currently, but when more become public we'll fill this in.

The general guidance in this section should apply well to dbt also. 


<br>

### Basic Setup

The simplest setup is to maintain one table per activity. On a regular basis rebuild (materialize) each activity table (using dbt, BigQuery schedled queries, or something similar).

Both `activity_occurrence` and `activity_repeated_at` can be written as window functions over each table. 

```sql
 row_number() over (partition by coalesce (customer, anonymous_customer_id) order by ts asc) as activity_occurrence,
 lead(ts) over (partition by coalesce (customer, anonymous_customer_id) order by ts asc) as activity_repeated_at
```


<br>

### Incremental Updates

The Activity Schema was designed around updating its stream tables incrementally. For large data this saves a significant amount of time and cost and is the preferred way to manage an activity stream in production.

In theory incremental updates are straightforward. Each activity in an Activity Schema is immutable, so appending data to the stream tables should be sufficient to keep the activity stream in good shape.

In practice data is messy and this can get extremely hard. A few things to watch out for:

<br>

**Duplicate Timestamps**

Activities, as written, may not always fully immutable -- a frequent issue in practice is writing activity transformations where the `ts` value can be updated. 

For example, if a 'Closed Account' activity might be built on a source table that isn't immutable -- say the 'accounts' table with a `closed_at` timestamp. If the account is reopened, then closed again, the `closed_at` timestamp will change. A fully incremental processing approach will insert a new record into the stream -- leading to potentially duplicate activity ids. 

It's outside the scope of this document to discuss how to model data to avoid this. In practice, with real data, it's not always practical to do so, so an incremental processing approach will have to know how to detect and rebuild activities that have this issue.

<br>

**Late inserts**

Incremental processing generally maintains a time window for inserts -- say the time since the last successful insert and now. If new row appears with a timestamp older than the time window, it won't get processed. An incremental approach will have to look back and find those late rows. 

<br>

### Advanced Processing

Processing an activity stream can be a pretty deep topic. Because it's a fixed set of tables with a known format, it's possible to very deeply optimize how the stream is built and maintained. 

As a quick overview of some possible options, [Narrator's](https://www.narratordata.com) implementation of the Activity Schema covers the following

1. Support for a single stream or one stream per activity
2. Incremental updates by default
3. Nightly reconcilation: insert any rows that were missed during incremental updates due to arriving late to the source tables
4. Weekly historical data checks: Randomly samples source data tables to check for new records with old timestamps that might have been missed
5. Window deletes: Support for deleting a specific time window of data and reinserting it on each update
6. Identity resolution: Mapping and updating the `anonymous_customer_id` to `customer` over time: multi-user, multi-device, with the ability to change the user mapping historically
7. Aliasing customers: Allows remapping a `customer` to a new `customer` -- e.g. if someone changes their email address
8. Remove list: maintain a list of customers whose activities will not be inserted into the stream
9. Many-to-many SQL to activities: one transformation can create multiple activities and one activity can be created from several transformations


<br>

## Querying

An activity stream lives in a warehouse and is queried with SQL, just like other tables. That said, writing SQL by hand for an activity schema is challenging, and traditional joins using foreign keys aren't the best way to express queries.

Activity schemas are fundamentally built around a customer doing something in time. The best way to combine activities is time-based joins, which we call **relationships**. They are discussed in the [spec](2.0.md#relationships). The idea is that each of these concepts is sufficient to combine any activities in any way needed for analysis. Relationship-based querying is the approach that Narrator has taken over several years, and so far has worked to build any table needed for BI. 

Implementing relationships means providing a way for the user to express their query in terms of relationships, and from there generating the SQL to query the stream directly. Narrator provides a UI to express the activity relationships: "for all 'web_session' activities append the first in between 'submitted lead'". From there it issues a warehouse-specific query in SQL to return the result set.

Currently there is no open-source example for how to do this, but we expect to add in more resources over time. 
