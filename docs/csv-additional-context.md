**master-dealer-list.csv**
* Customer - Parent  Account  Number = acct_number
* Customer - Parent Account = acct_name
* Address1 = T/A means DBA, this column duplicates business name if no DBA or Additional address.
* don't use sales numbers yet - see below for additional info on how sales will be uploaded. 
* on column might say 'county' but it's really the State

The remaining files with 'display' in the names should match to the dealer, all we need to do is map the dealers in these files to their display (example: bjelin-displays.csv all dealers in this file have the bjlelin display)

**program-dealers**
* Customer - C = program the dealer belongs to = dealer_program 

**sales-report-example** 
* this is just to show you the exact structure the report will be, but my normal reports will be monthly or part month (so upload needs to be per month or partial month but have logic to check make sure no dups) 
* column - Product Group - C O L0 = product_category (this is what you really need out of this report the different product groups)
* normal monthly report we want to capture from this report:
  * value = total sales per category
  * cost = cost
  * profit = profit
  * gp = gross_profit
  * average price = avg_price
  * quantity = total sf or pcs (trim) just know units sold
  * count = individual number of orders per that category. 


so Hierarchy should be something like this
acct_number -> acct_name -> displays -> everything else maps to those like product_category,sales, count, etc all map to dealer account. This is super linear and not exactly how to setup tables and FK but trying to give you enough info to do it correctly.  
